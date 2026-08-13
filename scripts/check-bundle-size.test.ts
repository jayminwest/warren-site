import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
	type Budgets,
	diff,
	type Measurement,
	parseBudgets,
	type RouteMeasurement,
	updateBudgets,
} from "./bundle-size-ratchet.ts";
import { extractScripts, measure, measureRoute, srcAttr } from "./check-bundle-size.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

function fixture(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "check-bundle-size-"));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeTree(root: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
}

function budgets(overrides: Partial<Budgets> = {}): Budgets {
	return {
		totals: { raw: { js: 1000, css: 1000 }, gzip: { js: 500, css: 500 } },
		largest: { gzip: { js: 900, css: 900 } },
		routes: {},
		routeDefault: { scripts: 10, raw: 5000 },
		...overrides,
	};
}

function measurement(
	routes: RouteMeasurement[] = [],
	over: Partial<Measurement> = {},
): Measurement {
	return {
		totals: { raw: { js: 0, css: 0 }, gzip: { js: 0, css: 0 } },
		largest: { gzip: { js: 0, css: 0 } },
		assets: [],
		routes,
		...over,
	};
}

describe("parseBudgets", () => {
	test("accepts a well-formed document", () => {
		const parsed = parseBudgets({
			totals: { raw: { js: 10, css: 20 }, gzip: { js: 5, css: 6 } },
			largest: { gzip: { js: 4, css: 3 } },
			routes: { "index.html": { scripts: 0, raw: 0 } },
			routeDefault: { scripts: 12, raw: 9000 },
		});
		expect(parsed.totals.raw.js).toBe(10);
		expect(parsed.routes["index.html"]).toEqual({ scripts: 0, raw: 0 });
		expect(parsed.routeDefault.scripts).toBe(12);
	});

	test("accepts zero, which is a meaningful budget here", () => {
		const parsed = parseBudgets({
			totals: { raw: { js: 0, css: 0 }, gzip: { js: 0, css: 0 } },
			largest: { gzip: { js: 0, css: 0 } },
			routes: {},
			routeDefault: { scripts: 0, raw: 0 },
		});
		expect(parsed.totals.raw.js).toBe(0);
	});

	test("rejects a missing totals block", () => {
		expect(() => parseBudgets({ largest: { gzip: { js: 1, css: 1 } } })).toThrow(/totals/);
	});

	test("rejects a negative number", () => {
		expect(() =>
			parseBudgets({
				totals: { raw: { js: -1, css: 1 }, gzip: { js: 1, css: 1 } },
				largest: { gzip: { js: 1, css: 1 } },
				routes: {},
				routeDefault: { scripts: 1, raw: 1 },
			}),
		).toThrow(/non-negative integer/);
	});

	test("rejects a non-integer number", () => {
		expect(() =>
			parseBudgets({
				totals: { raw: { js: 1.5, css: 1 }, gzip: { js: 1, css: 1 } },
				largest: { gzip: { js: 1, css: 1 } },
				routes: {},
				routeDefault: { scripts: 1, raw: 1 },
			}),
		).toThrow(/non-negative integer/);
	});

	test("rejects a route entry that is not an object", () => {
		expect(() =>
			parseBudgets({
				totals: { raw: { js: 1, css: 1 }, gzip: { js: 1, css: 1 } },
				largest: { gzip: { js: 1, css: 1 } },
				routes: { "index.html": 0 },
				routeDefault: { scripts: 1, raw: 1 },
			}),
		).toThrow(/must be an object/);
	});

	test("rejects a missing routeDefault", () => {
		expect(() =>
			parseBudgets({
				totals: { raw: { js: 1, css: 1 }, gzip: { js: 1, css: 1 } },
				largest: { gzip: { js: 1, css: 1 } },
				routes: {},
			}),
		).toThrow(/routeDefault/);
	});
});

describe("extractScripts / srcAttr", () => {
	test("finds inline and external scripts", () => {
		const found = extractScripts(
			`<html><script src="/a.js"></script><script>console.log(1)</script></html>`,
		);
		expect(found.length).toBe(2);
		expect(srcAttr(found[0]?.attrs ?? "")).toBe("/a.js");
		expect(found[1]?.body).toBe("console.log(1)");
	});

	test("returns nothing for a page with no scripts", () => {
		expect(extractScripts("<html><body><p>hi</p></body></html>")).toEqual([]);
	});

	test("ignores HTML-escaped script samples in prose", () => {
		expect(
			extractScripts("<p>write &lt;script src=&quot;x.js&quot;&gt;&lt;/script&gt;</p>"),
		).toEqual([]);
	});

	test("handles single-quoted and unquoted src, and type attributes", () => {
		expect(srcAttr(` type="module" src='/b.js'`)).toBe("/b.js");
		expect(srcAttr(" src=/c.js")).toBe("/c.js");
		expect(srcAttr(" defer")).toBeNull();
	});
});

describe("measureRoute", () => {
	const sizeOf = (p: string): number => ({ "a.js": 100, "b.js": 250 })[p] ?? 0;

	test("counts a page with no scripts as zero on both metrics", () => {
		expect(measureRoute("index.html", "<html><h1>hi</h1></html>", sizeOf)).toEqual({
			route: "index.html",
			scripts: 0,
			raw: 0,
		});
	});

	test("sums referenced asset sizes", () => {
		const r = measureRoute(
			"p.html",
			`<script src="/a.js"></script><script src="/b.js"></script>`,
			sizeOf,
		);
		expect(r).toEqual({ route: "p.html", scripts: 2, raw: 350 });
	});

	test("counts a repeated src once but still counts both script elements", () => {
		const r = measureRoute(
			"p.html",
			`<script src="/a.js"></script><script src="/a.js"></script>`,
			sizeOf,
		);
		expect(r.scripts).toBe(2);
		expect(r.raw).toBe(100);
	});

	test("counts inline script bodies by byte length", () => {
		const r = measureRoute("p.html", "<script>abcd</script>", sizeOf);
		expect(r).toEqual({ route: "p.html", scripts: 1, raw: 4 });
	});

	test("counts an external CDN script as a script with no measurable bytes", () => {
		const r = measureRoute("p.html", `<script src="https://cdn.example/x.js"></script>`, sizeOf);
		expect(r).toEqual({ route: "p.html", scripts: 1, raw: 0 });
	});

	test("strips a query string before resolving the asset", () => {
		expect(measureRoute("p.html", `<script src="/a.js?v=2"></script>`, sizeOf).raw).toBe(100);
	});
});

describe("measure", () => {
	test("aggregates raw + gzip totals and the largest chunk per bucket", () => {
		const { root, cleanup } = fixture();
		try {
			const big = "a".repeat(5000);
			const small = "b".repeat(100);
			writeTree(root, {
				"_astro/big.js": big,
				"_astro/small.js": small,
				"_astro/site.css": "c".repeat(700),
				"pagefind/search.js": "d".repeat(300),
				"index.html": "<html></html>",
				"logo.png": "not-counted",
			});
			const m = measure(root);
			expect(m.totals.raw.js).toBe(5000 + 100 + 300);
			expect(m.totals.raw.css).toBe(700);
			expect(m.totals.gzip.js).toBe(
				gzipSync(Buffer.from(big)).length +
					gzipSync(Buffer.from(small)).length +
					gzipSync(Buffer.from("d".repeat(300))).length,
			);
			expect(m.largest.gzip.js).toBe(gzipSync(Buffer.from(big)).length);
			expect(m.largest.gzip.css).toBe(gzipSync(Buffer.from("c".repeat(700))).length);
			expect(m.assets.map((a) => a.name)).toContain("pagefind/search.js");
			expect(m.assets.map((a) => a.name)).not.toContain("logo.png");
		} finally {
			cleanup();
		}
	});

	test("measures every html page as a route, sorted", () => {
		const { root, cleanup } = fixture();
		try {
			writeTree(root, {
				"_astro/app.js": "x".repeat(42),
				"index.html": "<html></html>",
				"docs/a/index.html": `<script src="/_astro/app.js"></script>`,
			});
			const m = measure(root);
			expect(m.routes.map((r) => r.route)).toEqual(["docs/a/index.html", "index.html"]);
			expect(m.routes[0]).toEqual({ route: "docs/a/index.html", scripts: 1, raw: 42 });
			expect(m.routes[1]).toEqual({ route: "index.html", scripts: 0, raw: 0 });
		} finally {
			cleanup();
		}
	});

	test("returns an empty measurement for a missing dist", () => {
		const m = measure(join(tmpdir(), "definitely-not-a-dist-dir-xyz"));
		expect(m.assets).toEqual([]);
		expect(m.routes).toEqual([]);
	});
});

describe("diff", () => {
	test("passes when everything is inside budget", () => {
		const m = measurement([{ route: "index.html", scripts: 0, raw: 0 }]);
		expect(diff(m, budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } }))).toEqual([]);
	});

	test("flags a totals overage", () => {
		const m = measurement([], { totals: { raw: { js: 2000, css: 0 }, gzip: { js: 0, css: 0 } } });
		const failures = diff(m, budgets());
		expect(failures).toEqual([{ metric: "totals.raw", scope: "js", actual: 2000, budget: 1000 }]);
	});

	test("flags a largest-chunk overage even when totals hold", () => {
		const m = measurement([], { largest: { gzip: { js: 950, css: 0 } } });
		expect(diff(m, budgets())[0]?.metric).toBe("largest.gzip");
	});

	test("flags ONE script on a zero-JS route", () => {
		const m = measurement([{ route: "index.html", scripts: 1, raw: 12 }]);
		const failures = diff(m, budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } }));
		expect(failures.map((f) => f.metric)).toEqual(["route.scripts", "route.raw"]);
		expect(failures[0]?.scope).toBe("index.html");
	});

	test("an unlisted route answers to routeDefault", () => {
		const m = measurement([{ route: "docs/x/index.html", scripts: 40, raw: 90000 }]);
		const failures = diff(m, budgets());
		expect(failures.map((f) => f.metric)).toEqual(["routeDefault.scripts", "routeDefault.raw"]);
	});

	test("a loose routeDefault does not rescue a pinned zero route", () => {
		const m = measurement([
			{ route: "index.html", scripts: 1, raw: 500 },
			{ route: "docs/x/index.html", scripts: 9, raw: 4000 },
		]);
		const failures = diff(m, budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } }));
		expect(failures.every((f) => f.scope === "index.html")).toBe(true);
	});
});

describe("updateBudgets", () => {
	/** Comfortably under every budget in the fixture, even after headroom. */
	const measured = (over: Partial<Measurement["totals"]> = {}): Measurement =>
		measurement([], {
			totals: { raw: { js: 100, css: 100 }, gzip: { js: 50, css: 50 }, ...over },
			largest: { gzip: { js: 50, css: 50 } },
		});

	test("lowering always applies, with no override needed", () => {
		const { budgets: next, refused, autoRaised } = updateBudgets(measured(), budgets(), false);
		expect(next.totals.raw.js).toBe(100 + 800);
		expect(next.largest.gzip.js).toBe(50 + 400);
		expect(refused).toEqual([]);
		expect(autoRaised).toEqual([]);
	});

	test("a raise within the cap re-baselines hands-free", () => {
		const m = measured({ raw: { js: 5000, css: 100 } });
		const { budgets: next, refused, autoRaised } = updateBudgets(m, budgets(), false);
		expect(next.totals.raw.js).toBe(5800);
		expect(refused).toEqual([]);
		expect(autoRaised.join()).toMatch(/totals\.raw\.js/);
	});

	test("a raise past the cap is refused and the old budget is kept", () => {
		const m = measured({ raw: { js: 500000, css: 100 } });
		const { budgets: next, refused } = updateBudgets(m, budgets(), false);
		expect(next.totals.raw.js).toBe(1000);
		expect(refused.join()).toMatch(/exceeds 24576 cap/);
	});

	test("the override lets a past-cap raise through", () => {
		const m = measured({ raw: { js: 500000, css: 100 } });
		const { budgets: next, refused } = updateBudgets(m, budgets(), true);
		expect(next.totals.raw.js).toBe(500800);
		expect(refused).toEqual([]);
	});

	test("a zero route budget is LOCKED — even one byte of JS is refused", () => {
		const m = measurement([{ route: "index.html", scripts: 1, raw: 1 }]);
		const current = budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } });
		const { budgets: next, refused } = updateBudgets(m, current, false);
		expect(next.routes["index.html"]).toEqual({ scripts: 0, raw: 0 });
		expect(refused.join()).toMatch(/locked at zero/);
	});

	test("the override is the only way off a locked zero", () => {
		const m = measurement([{ route: "index.html", scripts: 1, raw: 1 }]);
		const current = budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } });
		const { budgets: next, refused } = updateBudgets(m, current, true);
		expect(next.routes["index.html"]).toEqual({ scripts: 3, raw: 513 });
		expect(refused).toEqual([]);
	});

	test("a measured zero re-baselines to exactly zero, not zero-plus-headroom", () => {
		const m = measurement([{ route: "index.html", scripts: 0, raw: 0 }]);
		const current = budgets({ routes: { "index.html": { scripts: 5, raw: 900 } } });
		const { budgets: next } = updateBudgets(m, current, false);
		expect(next.routes["index.html"]).toEqual({ scripts: 0, raw: 0 });
	});

	test("routeDefault re-baselines from the WORST unlisted route", () => {
		const m = measurement([
			{ route: "a.html", scripts: 2, raw: 100 },
			{ route: "b.html", scripts: 7, raw: 3000 },
			{ route: "index.html", scripts: 0, raw: 0 },
		]);
		const current = budgets({ routes: { "index.html": { scripts: 0, raw: 0 } } });
		const { budgets: next } = updateBudgets(m, current, false);
		expect(next.routeDefault).toEqual({ scripts: 9, raw: 3512 });
	});
});

describe("committed budget file", () => {
	const doc = JSON.parse(
		readFileSync(resolve(REPO_ROOT, "budgets/bundle-size-budgets.json"), "utf8"),
	) as unknown;

	test("parses under the real schema", () => {
		expect(() => parseBudgets(doc)).not.toThrow();
	});

	test("holds the standalone routes to the analytics tags only", () => {
		// Relaxed from zero on 2026-08-13 for ad-campaign measurement: the
		// Vercel insights loader plus the two Google-tag scripts, and nothing
		// else. See $comment_routes in the budget file and
		// src/config/analytics.ts. Ceilings = 3 sanctioned tags + --update
		// headroom; a hydration island or prefetch runtime must still trip.
		const parsed = parseBudgets(doc);
		for (const route of ["index.html", "changelog/index.html"]) {
			const budget = parsed.routes[route];
			expect(budget?.scripts).toBeLessThanOrEqual(5);
			expect(budget?.raw).toBeLessThanOrEqual(2048);
		}
	});

	test("keeps the docs routeDefault looser than the pinned landing routes", () => {
		const parsed = parseBudgets(doc);
		expect(parsed.routeDefault.scripts).toBeGreaterThan(0);
		expect(parsed.routeDefault.raw).toBeGreaterThan(0);
	});
});
