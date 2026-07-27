#!/usr/bin/env bun
/**
 * Bundle-size guard for the Astro build (`dist/`).
 *
 * Adapted from warren's `scripts/check-bundle-size.ts`, which guards a Vite
 * SPA. Same shape — measure, compare against a frozen ratchet, re-baseline
 * only through `--update` — but Astro emits a static site, so there is no
 * single "app bundle": there is a pile of hashed assets under `dist/_astro/`
 * plus whatever the search integration drops in `dist/pagefind/`, and 60-odd
 * HTML pages that each pull a DIFFERENT subset of that pile.
 *
 * So this guard enforces two ratchets, recorded in
 * `budgets/bundle-size-budgets.json`. Budget shapes and the re-baselining
 * policy live in `bundle-size-ratchet.ts`; this file measures and reports.
 *
 * 1. SITE TOTALS — every `.js` / `.css` file anywhere under `dist/`:
 *      - `totals.raw.{js,css}`    total uncompressed bytes per extension
 *      - `totals.gzip.{js,css}`   total gzipped bytes per extension
 *      - `largest.gzip.{js,css}`  gzipped size of the single biggest file,
 *        which catches one chunk ballooning while the total stays flat
 *    This is the "did someone add a heavy dependency" ratchet.
 *
 * 2. PER-ROUTE JS — for every `*.html` page, the JavaScript that page
 *    actually pulls: the raw size of each distinct `<script src>` it
 *    references, plus the body bytes of every inline `<script>`. Tracked as
 *    `{ scripts, raw }` — a COUNT of script elements and a byte total.
 *    Routes listed in `routes` answer to their own entry; everything else
 *    answers to `routeDefault`.
 *    This is the "did someone reintroduce client JS on a page that had
 *    none" ratchet, and it is why a totals-only guard is not enough: the
 *    landing page could sprout a 2KB hydration island and the site totals
 *    would barely twitch.
 *
 * WHY A SEPARATE, MUCH TIGHTER BUDGET FOR THE LANDING ROUTE
 * `astro.config.mjs` sets `prefetch: false` specifically so `/` and
 * `/changelog/` ship with ZERO `<script>` tags — no prefetch runtime, no
 * hydration, nothing. That is a real property of the site and one nobody
 * notices breaking: adding a `client:load` island or flipping prefetch back
 * on silently reintroduces JS and no other gate complains. Those two routes
 * therefore get `{ scripts: 0, raw: 0 }`, and a zero is LOCKED — `--update`
 * will not raise a zero budget off zero however small the regression.
 * Starlight's docs routes legitimately ship a search client, a theme toggle
 * and a ToC observer, so they answer to the far looser `routeDefault`. One
 * shared budget would have to be the loose one, and the zero-JS guarantee
 * would be unenforceable.
 *
 * GZIP PARITY — the trap warren's budgets record twice
 * Gzip here is Node's `zlib.gzipSync` at its default level (6). NEVER take a
 * number from a build-log reporter: warren's `bundle-size-budgets.json` holds
 * two post-mortems for exactly that, where Vite's build-log gzip ran ~2KB
 * COOLER than Node zlib, so an eyeballed budget landed too tight and CI
 * tripped. Astro prints a similar report. Ignore it — the only supported way
 * to write these numbers is `--update`, which measures with the SAME gzip the
 * check enforces, so a budget it writes always passes. warren's second
 * post-mortem, a stale `node_modules` producing a different bundle than CI,
 * applies here too: if your numbers disagree with CI, reinstall from the
 * lockfile and rebuild rather than padding the budget.
 *
 * Usage:
 *   bun run scripts/check-bundle-size.ts              # measure existing dist/
 *   bun run scripts/check-bundle-size.ts --build      # astro build, then measure
 *   bun run scripts/check-bundle-size.ts --build --update   # re-baseline
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
	BUCKETS,
	type Bucket,
	type Budgets,
	diff,
	type Measurement,
	parseBudgets,
	type RouteMeasurement,
	updateBudgets,
} from "./bundle-size-ratchet.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BUDGETS_PATH = resolve(REPO_ROOT, "budgets", "bundle-size-budgets.json");
const DIST_DIR = resolve(REPO_ROOT, "dist");

export function loadBudgets(path = BUDGETS_PATH): Budgets {
	return parseBudgets(JSON.parse(readFileSync(path, "utf8")), path);
}

function bucketFor(name: string): Bucket | null {
	if (name.endsWith(".js")) return "js";
	if (name.endsWith(".css")) return "css";
	return null;
}

function* walk(dir: string): Generator<string> {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) yield* walk(full);
		else if (st.isFile()) yield full;
	}
}

/**
 * Every `<script>` element in a page, as its open-tag attributes and its body.
 * Script samples inside docs prose are HTML-escaped by the Markdown renderer
 * (`&lt;script`), so they cannot produce a false positive here.
 */
export function extractScripts(html: string): Array<{ attrs: string; body: string }> {
	const out: Array<{ attrs: string; body: string }> = [];
	const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
	let m: RegExpExecArray | null = re.exec(html);
	while (m !== null) {
		out.push({ attrs: m[1] ?? "", body: m[2] ?? "" });
		m = re.exec(html);
	}
	return out;
}

export function srcAttr(attrs: string): string | null {
	const m = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
	if (!m) return null;
	return m[2] ?? m[3] ?? m[4] ?? null;
}

/**
 * JS weight of one page: the raw size of each DISTINCT local `<script src>`
 * target plus the body bytes of every inline script. External (`http:`,
 * `//cdn`) sources contribute no measurable bytes but still count as scripts.
 */
export function measureRoute(
	route: string,
	html: string,
	sizeOf: (assetPath: string) => number,
): RouteMeasurement {
	const scripts = extractScripts(html);
	const seen = new Set<string>();
	let raw = 0;
	for (const { attrs, body } of scripts) {
		const src = srcAttr(attrs);
		if (src === null) {
			raw += Buffer.byteLength(body, "utf8");
			continue;
		}
		if (/^([a-z]+:)?\/\//i.test(src)) continue;
		const rel = src.replace(/^\//, "").split("?")[0] ?? "";
		if (seen.has(rel)) continue;
		seen.add(rel);
		raw += sizeOf(rel);
	}
	return { route, scripts: scripts.length, raw };
}

export function measure(distDir = DIST_DIR): Measurement {
	const out: Measurement = {
		totals: { raw: { js: 0, css: 0 }, gzip: { js: 0, css: 0 } },
		largest: { gzip: { js: 0, css: 0 } },
		assets: [],
		routes: [],
	};
	if (!existsSync(distDir)) return out;

	const htmlFiles: string[] = [];
	const rawSizes = new Map<string, number>();
	for (const abs of walk(distDir)) {
		const rel = relative(distDir, abs).replaceAll("\\", "/");
		const size = statSync(abs).size;
		rawSizes.set(rel, size);
		if (rel.endsWith(".html")) {
			htmlFiles.push(rel);
			continue;
		}
		const bucket = bucketFor(rel);
		if (!bucket) continue;
		const gzip = gzipSync(readFileSync(abs)).length;
		out.assets.push({ name: rel, bucket, raw: size, gzip });
		out.totals.raw[bucket] += size;
		out.totals.gzip[bucket] += gzip;
		if (gzip > out.largest.gzip[bucket]) out.largest.gzip[bucket] = gzip;
	}
	out.assets.sort((a, b) => b.gzip - a.gzip);

	const sizeOf = (p: string): number => rawSizes.get(p) ?? 0;
	for (const rel of htmlFiles.sort()) {
		out.routes.push(measureRoute(rel, readFileSync(join(distDir, rel), "utf8"), sizeOf));
	}
	return out;
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	return `${(n / 1024).toFixed(2)} KiB (${n} B)`;
}

/** Rewrite the numeric fields in place so every `$comment*` key survives. */
function writeBudgets(path: string, budgets: Budgets): void {
	const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	doc.totals = budgets.totals;
	doc.largest = budgets.largest;
	doc.routes = budgets.routes;
	doc.routeDefault = budgets.routeDefault;
	writeFileSync(path, `${JSON.stringify(doc, null, "\t")}\n`);
}

function runBuild(): void {
	console.log("Running `bun run build` ...");
	const result = spawnSync("bun", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function reportMeasurement(m: Measurement, budgets: Budgets): void {
	console.log("Bundle-size measurement (dist/):");
	for (const a of m.assets.slice(0, 8)) {
		console.log(`  ${a.name}: raw ${fmtBytes(a.raw)}, gzip ${fmtBytes(a.gzip)}`);
	}
	if (m.assets.length > 8) console.log(`  … ${m.assets.length - 8} more assets`);
	for (const b of BUCKETS) {
		console.log(
			`  totals.${b}: raw ${fmtBytes(m.totals.raw[b])} / ${fmtBytes(budgets.totals.raw[b])}; ` +
				`gzip ${fmtBytes(m.totals.gzip[b])} / ${fmtBytes(budgets.totals.gzip[b])}; ` +
				`largest gzip ${fmtBytes(m.largest.gzip[b])} / ${fmtBytes(budgets.largest.gzip[b])}`,
		);
	}
	for (const route of Object.keys(budgets.routes).sort()) {
		const r = m.routes.find((x) => x.route === route);
		const b = budgets.routes[route];
		if (!r || !b) continue;
		console.log(
			`  route ${route}: ${r.scripts} script(s) / ${b.scripts}, js ${fmtBytes(r.raw)} / ${fmtBytes(b.raw)}`,
		);
	}
	const others = m.routes.filter((r) => budgets.routes[r.route] === undefined);
	const worst = others.reduce<RouteMeasurement | null>(
		(a, r) => (a && a.raw >= r.raw ? a : r),
		null,
	);
	if (worst) {
		console.log(
			`  routeDefault (${others.length} routes): worst ${worst.route} — ` +
				`${worst.scripts} script(s) / ${budgets.routeDefault.scripts}, ` +
				`js ${fmtBytes(worst.raw)} / ${fmtBytes(budgets.routeDefault.raw)}`,
		);
	}
}

function runUpdate(m: Measurement, current: Budgets): void {
	const { budgets, refused, autoRaised } = updateBudgets(m, current);
	if (refused.length > 0) {
		console.error("\nBundle-size --update refused to raise these budgets:");
		for (const r of refused) console.error(`  ${r}`);
		console.error(
			"\nA zero-JS route budget is locked by design, and growth past the auto-raise cap should " +
				"be a deliberate new floor (a heavy new dependency). If you really mean it, re-run with " +
				"WARREN_SITE_BUNDLE_SIZE_ALLOW_RAISE=1 and record why in a $comment.",
		);
		process.exit(1);
	}
	writeBudgets(BUDGETS_PATH, budgets);
	console.log(`Wrote re-baselined budgets to ${BUDGETS_PATH} (measured + headroom).`);
	for (const r of autoRaised) console.log(`  auto-raised ${r}`);
}

function main(): void {
	const args = new Set(process.argv.slice(2));
	if (args.has("--build") || process.env.WARREN_SITE_BUNDLE_SIZE_BUILD === "1") runBuild();

	if (!existsSync(DIST_DIR)) {
		console.error(`Bundle-size guard: ${DIST_DIR} does not exist.`);
		console.error("Run `bun run build` first, or pass --build to this script.");
		process.exit(1);
	}

	const m = measure();
	const budgets = loadBudgets();

	if (args.has("--update")) {
		runUpdate(m, budgets);
		return;
	}

	reportMeasurement(m, budgets);

	const failures = diff(m, budgets);
	if (failures.length > 0) {
		console.error("\nBundle-size guard failed:");
		for (const f of failures) {
			console.error(
				`  ${f.metric} [${f.scope}]: actual ${f.actual} exceeds budget ${f.budget} (+${f.actual - f.budget})`,
			);
		}
		console.error(
			"\nTip: do NOT hand-edit budgets/bundle-size-budgets.json from a build-log gzip figure — " +
				"build reporters run cooler than this guard's Node-zlib gzip, so eyeballed budgets fail CI. " +
				"Re-baseline with `bun run scripts/check-bundle-size.ts --build --update`. " +
				"A failing zero-JS route budget is NOT a re-baseline candidate: remove the script instead.",
		);
		process.exit(1);
	}

	console.log("Bundle-size guard ok.");
}

if (import.meta.main) main();
