import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AllowEntry,
	compareFindings,
	type Finding,
	findHtmlPages,
	formatGroup,
	groupFindings,
	type Impact,
	isFailingImpact,
	loadAllowlist,
	matchesAllowEntry,
	normalizeImpact,
	parseAllowlist,
	readHtml,
	triage,
} from "./check-a11y.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

function finding(over: Partial<Finding> = {}): Finding {
	return {
		page: "index.html",
		rule: "color-contrast",
		impact: "serious",
		selector: "a.brand",
		help: "Elements must meet contrast",
		helpUrl: "https://example.test/rule",
		...over,
	};
}

function entry(over: Partial<AllowEntry> = {}): AllowEntry {
	return {
		rule: "color-contrast",
		page: "index.html",
		selector: "a.brand",
		reason: "tracked in warren-site-0001",
		...over,
	};
}

describe("impact handling", () => {
	test("critical and serious fail the build", () => {
		expect(isFailingImpact("critical")).toBe(true);
		expect(isFailingImpact("serious")).toBe(true);
	});

	test("moderate and minor do not fail the build", () => {
		expect(isFailingImpact("moderate")).toBe(false);
		expect(isFailingImpact("minor")).toBe(false);
	});

	test("normalizeImpact passes through the four known impacts", () => {
		for (const i of ["critical", "serious", "moderate", "minor"] satisfies Impact[]) {
			expect(normalizeImpact(i)).toBe(i);
		}
	});

	test("normalizeImpact downgrades an unknown or absent impact to minor", () => {
		expect(normalizeImpact(null)).toBe("minor");
		expect(normalizeImpact(undefined)).toBe("minor");
		expect(normalizeImpact("catastrophic")).toBe("minor");
		expect(normalizeImpact(7)).toBe("minor");
	});
});

describe("parseAllowlist", () => {
	test("accepts an empty allowlist, which is the committed state", () => {
		expect(parseAllowlist({ allow: [] }).allow).toEqual([]);
	});

	test("accepts a well-formed entry", () => {
		const parsed = parseAllowlist({ allow: [entry()] });
		expect(parsed.allow[0]?.rule).toBe("color-contrast");
	});

	test("rejects a document with no allow array", () => {
		expect(() => parseAllowlist({})).toThrow(/"allow" must be an array/);
		expect(() => parseAllowlist({ allow: "nope" })).toThrow(/"allow" must be an array/);
	});

	test("rejects an entry missing a reason", () => {
		expect(() => parseAllowlist({ allow: [{ rule: "r", page: "p", selector: "s" }] })).toThrow(
			/allow\[0\]\.reason/,
		);
	});

	test("rejects an empty-string field", () => {
		expect(() => parseAllowlist({ allow: [{ ...entry(), reason: "" }] })).toThrow(
			/allow\[0\]\.reason/,
		);
	});

	test("rejects a non-object entry", () => {
		expect(() => parseAllowlist({ allow: ["color-contrast"] })).toThrow(/allow\[0\] must be/);
	});

	test("loadAllowlist treats a missing file as empty", () => {
		expect(loadAllowlist(join(tmpdir(), "no-such-a11y-allowlist.json")).allow).toEqual([]);
	});
});

describe("matchesAllowEntry", () => {
	test("matches on exact rule, page and selector", () => {
		expect(matchesAllowEntry(entry(), finding())).toBe(true);
	});

	test("does not match a different rule", () => {
		expect(matchesAllowEntry(entry({ rule: "label" }), finding())).toBe(false);
	});

	test("does not match a different page", () => {
		expect(matchesAllowEntry(entry({ page: "changelog/index.html" }), finding())).toBe(false);
	});

	test("does not match a different selector", () => {
		expect(matchesAllowEntry(entry({ selector: "footer a" }), finding())).toBe(false);
	});

	test("a page wildcard matches every page", () => {
		const e = entry({ page: "*" });
		expect(matchesAllowEntry(e, finding({ page: "docs/x/index.html" }))).toBe(true);
	});

	test("a selector wildcard matches every node", () => {
		const e = entry({ selector: "*" });
		expect(matchesAllowEntry(e, finding({ selector: "main > p" }))).toBe(true);
	});

	test("a wildcard never widens the rule match", () => {
		const e = entry({ page: "*", selector: "*" });
		expect(matchesAllowEntry(e, finding({ rule: "aria-roles" }))).toBe(false);
	});
});

describe("triage", () => {
	test("serious and critical findings fail; moderate and minor warn", () => {
		const result = triage(
			[
				finding({ impact: "critical", rule: "a" }),
				finding({ impact: "serious", rule: "b" }),
				finding({ impact: "moderate", rule: "c" }),
				finding({ impact: "minor", rule: "d" }),
			],
			{ allow: [] },
		);
		expect(result.failures.map((f) => f.rule)).toEqual(["a", "b"]);
		expect(result.warnings.map((f) => f.rule)).toEqual(["c", "d"]);
		expect(result.allowed).toEqual([]);
	});

	test("an allowlisted finding is suppressed rather than failing", () => {
		const result = triage([finding()], { allow: [entry()] });
		expect(result.failures).toEqual([]);
		expect(result.allowed.length).toBe(1);
		expect(result.staleEntries).toEqual([]);
	});

	test("the allowlist suppresses only the entry that matches", () => {
		const result = triage([finding(), finding({ rule: "label", page: "other.html" })], {
			allow: [entry()],
		});
		expect(result.failures.map((f) => f.rule)).toEqual(["label"]);
		expect(result.allowed.length).toBe(1);
	});

	test("an entry that matches nothing is reported stale — the ratchet only goes down", () => {
		const result = triage([], { allow: [entry()] });
		expect(result.staleEntries).toEqual([entry()]);
	});

	test("one entry covering several pages is used, not stale", () => {
		const result = triage([finding({ page: "a.html" }), finding({ page: "b.html" })], {
			allow: [entry({ page: "*" })],
		});
		expect(result.allowed.length).toBe(2);
		expect(result.staleEntries).toEqual([]);
	});

	test("failures sort by impact severity first", () => {
		const result = triage(
			[finding({ impact: "serious", rule: "z" }), finding({ impact: "critical", rule: "a" })],
			{ allow: [] },
		);
		expect(result.failures.map((f) => f.impact)).toEqual(["critical", "serious"]);
	});

	test("an empty run produces nothing anywhere", () => {
		expect(triage([], { allow: [] })).toEqual({
			failures: [],
			warnings: [],
			allowed: [],
			staleEntries: [],
		});
	});
});

describe("compareFindings", () => {
	test("orders critical before minor", () => {
		expect(
			compareFindings(finding({ impact: "critical" }), finding({ impact: "minor" })),
		).toBeLessThan(0);
	});

	test("breaks impact ties on rule id, then page", () => {
		expect(compareFindings(finding({ rule: "a" }), finding({ rule: "b" }))).toBeLessThan(0);
		expect(compareFindings(finding({ page: "a.html" }), finding({ page: "b.html" }))).toBeLessThan(
			0,
		);
		expect(compareFindings(finding(), finding())).toBe(0);
	});
});

describe("groupFindings / formatGroup", () => {
	test("collapses the same rule+selector across pages and keeps every page", () => {
		const groups = groupFindings([
			finding({ page: "a.html" }),
			finding({ page: "b.html" }),
			finding({ page: "c.html" }),
		]);
		expect(groups.length).toBe(1);
		expect(groups[0]?.pages).toEqual(["a.html", "b.html", "c.html"]);
	});

	test("keeps different selectors of the same rule apart", () => {
		const groups = groupFindings([finding(), finding({ selector: "footer a" })]);
		expect(groups.length).toBe(2);
	});

	test("does not double-count a page repeated within one group", () => {
		const groups = groupFindings([finding(), finding()]);
		expect(groups[0]?.pages).toEqual(["index.html"]);
	});

	test("orders by impact, then by how many pages are affected", () => {
		const groups = groupFindings([
			finding({ impact: "minor", rule: "m", selector: "x", page: "1.html" }),
			finding({ impact: "serious", rule: "s", selector: "y", page: "1.html" }),
			finding({ impact: "serious", rule: "t", selector: "z", page: "1.html" }),
			finding({ impact: "serious", rule: "t", selector: "z", page: "2.html" }),
		]);
		expect(groups.map((g) => g.rule)).toEqual(["t", "s", "m"]);
	});

	test("formatGroup names the rule, impact, selector and every page by default", () => {
		const [group] = groupFindings([finding({ page: "a.html" }), finding({ page: "b.html" })]);
		if (!group) throw new Error("expected a group");
		const text = formatGroup(group);
		expect(text).toContain("SERIOUS");
		expect(text).toContain("color-contrast");
		expect(text).toContain("a.brand");
		expect(text).toContain("a.html, b.html");
		expect(text).toContain("https://example.test/rule");
		expect(text).not.toContain("more");
	});

	test("formatGroup truncates the page list when a cap is given", () => {
		const [group] = groupFindings(
			["a", "b", "c", "d", "e"].map((p) => finding({ page: `${p}.html` })),
		);
		if (!group) throw new Error("expected a group");
		const text = formatGroup(group, 2);
		expect(text).toContain("a.html, b.html, … +3 more");
		expect(text).toContain("(5 page(s))");
	});
});

describe("findHtmlPages", () => {
	test("finds every html page recursively, sorted, and ignores other files", () => {
		const root = mkdtempSync(join(tmpdir(), "check-a11y-"));
		try {
			for (const rel of ["index.html", "docs/b/index.html", "docs/a/index.html", "app.js"]) {
				const full = join(root, rel);
				mkdirSync(join(full, ".."), { recursive: true });
				writeFileSync(full, "x");
			}
			expect(findHtmlPages(root)).toEqual(["docs/a/index.html", "docs/b/index.html", "index.html"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns nothing for a directory that does not exist", () => {
		expect(findHtmlPages(join(tmpdir(), "definitely-no-dist-here-xyz"))).toEqual([]);
	});
});

describe("readHtml", () => {
	test("reads a page that exists", () => {
		const root = mkdtempSync(join(tmpdir(), "check-a11y-read-"));
		try {
			writeFileSync(join(root, "p.html"), "<html>ok</html>");
			expect(readHtml(join(root, "p.html"))).toBe("<html>ok</html>");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null for a page that vanished mid-run instead of throwing", () => {
		expect(readHtml(join(tmpdir(), "vanished-page-xyz.html"))).toBeNull();
	});
});

describe("committed allowlist file", () => {
	const doc = JSON.parse(
		readFileSync(resolve(REPO_ROOT, "budgets/a11y-allowlist.json"), "utf8"),
	) as unknown;

	test("parses under the real schema", () => {
		expect(() => parseAllowlist(doc)).not.toThrow();
	});

	test("is EMPTY — nothing in this repo is grandfathered", () => {
		expect(parseAllowlist(doc).allow).toEqual([]);
	});
});
