#!/usr/bin/env bun
/**
 * Accessibility guard over the BUILT HTML in `dist/` — every page, not a sample.
 *
 * Second half of the `check:bundle-size` gate. That script name is a frozen
 * slot in the fleet's canonical gate manifest, so two concerns share it;
 * `check-bundle-size.ts --build` produces the build and this script audits it,
 * which is why neither builds twice.
 *
 * ENGINE CHOICE: axe-core driven over jsdom.
 * axe-core is the rule engine behind Lighthouse, Playwright's a11y fixture and
 * every commercial scanner, so its rule set is the one worth enforcing. The
 * only real decision is what DOM to feed it.
 *   - A browser driver (Playwright / puppeteer) is the thorough option and was
 *     rejected: it means a ~150MB browser download in every CI run plus a
 *     static server to point it at, for a gate that runs on every PR. It buys
 *     one thing jsdom cannot give — real layout, and therefore working
 *     colour-contrast — which is not worth minutes of CI on each push.
 *   - linkedom is faster than jsdom but implements too little of the DOM
 *     (getComputedStyle, Range, visibility) for axe to run its rules honestly.
 *   - jsdom parses the built HTML directly out of `dist/`, needs no server and
 *     no binary, and audits the whole site (122 pages at the time of writing)
 *     in well under a minute.
 * Pages are parsed with `runScripts: "outside-only"`: axe itself is evaluated
 * inside the window, but the site's own scripts never execute, so this audits
 * the server-rendered markup a first paint (and a text browser, and a crawler)
 * actually receives.
 *
 * KNOWN LIMIT, stated so nobody mistakes a pass for full coverage: rules that
 * need layout cannot run under jsdom. axe reports them as `incomplete` rather
 * than passing them, and this script prints that list every run. In practice
 * that is `color-contrast` plus a couple of landmark rules. Contrast is
 * governed by the theme tokens and design review, NOT by this gate.
 *
 * FAILURE POLICY: `critical` and `serious` violations fail the build.
 * `moderate` and `minor` print as warnings and do not. That split is
 * deliberate for a new site — the moderate/minor tier on a Starlight build is
 * dominated by best-practice rules about markup the site does not own — and it
 * is the tier to tighten first once the backlog is clear.
 *
 * ALLOWLIST: `budgets/a11y-allowlist.json`, same ratchet convention as the
 * other budget files. It starts EMPTY and should stay that way. An entry is a
 * permanent written record that a page shipped a serious defect, and the
 * ratchet only goes down: an entry that stops matching anything FAILS the gate
 * so it has to be deleted rather than left to rot.
 *
 * Usage:
 *   bun run scripts/check-a11y.ts
 *   bun run scripts/check-a11y.ts --dist dist --allowlist budgets/a11y-allowlist.json
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import axe from "axe-core";
import { JSDOM, VirtualConsole } from "jsdom";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_DIST = resolve(REPO_ROOT, "dist");
const DEFAULT_ALLOWLIST = resolve(REPO_ROOT, "budgets", "a11y-allowlist.json");
/**
 * axe-core publishes its own bundle as a string for exactly this purpose:
 * the engine has to be evaluated INSIDE the page's window, not in this
 * process. Using the package export rather than reading `axe.min.js` off
 * disk keeps the dependency visible to `check:deps` and pins the engine to
 * the lockfile.
 */
const AXE_SOURCE: string = axe.source;

export type Impact = "critical" | "serious" | "moderate" | "minor";
const IMPACT_ORDER: readonly Impact[] = ["critical", "serious", "moderate", "minor"] as const;
/** Impacts that fail the build. Tighten by moving "moderate" up here. */
const FAILING_IMPACTS: ReadonlySet<Impact> = new Set<Impact>(["critical", "serious"]);

export interface Finding {
	page: string;
	rule: string;
	impact: Impact;
	selector: string;
	help: string;
	helpUrl: string;
}

export interface AllowEntry {
	rule: string;
	page: string;
	selector: string;
	reason: string;
}

export interface Allowlist {
	allow: AllowEntry[];
}

export interface Triage {
	failures: Finding[];
	warnings: Finding[];
	allowed: Finding[];
	staleEntries: AllowEntry[];
}

export function isFailingImpact(impact: Impact): boolean {
	return FAILING_IMPACTS.has(impact);
}

/** Unknown/absent axe impacts are treated as `minor` rather than dropped. */
export function normalizeImpact(value: unknown): Impact {
	return IMPACT_ORDER.includes(value as Impact) ? (value as Impact) : "minor";
}

export function compareFindings(a: Finding, b: Finding): number {
	const byImpact = IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
	if (byImpact !== 0) return byImpact;
	if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
	return a.page < b.page ? -1 : a.page > b.page ? 1 : 0;
}

export function parseAllowlist(raw: unknown, label = "a11y allowlist"): Allowlist {
	if (raw === null || typeof raw !== "object") throw new Error(`${label}: not an object`);
	const allow = (raw as Record<string, unknown>).allow;
	if (!Array.isArray(allow)) throw new Error(`${label}: "allow" must be an array`);
	return {
		allow: allow.map((item, i) => {
			if (item === null || typeof item !== "object" || Array.isArray(item)) {
				throw new Error(`${label}: allow[${i}] must be an object`);
			}
			const e = item as Record<string, unknown>;
			for (const key of ["rule", "page", "selector", "reason"] as const) {
				if (typeof e[key] !== "string" || e[key] === "") {
					throw new Error(`${label}: allow[${i}].${key} must be a non-empty string`);
				}
			}
			return {
				rule: e.rule as string,
				page: e.page as string,
				selector: e.selector as string,
				reason: e.reason as string,
			};
		}),
	};
}

export function loadAllowlist(path = DEFAULT_ALLOWLIST): Allowlist {
	if (!existsSync(path)) return { allow: [] };
	return parseAllowlist(JSON.parse(readFileSync(path, "utf8")), path);
}

/**
 * An entry matches when the rule id is equal and `page` / `selector` are either
 * equal or the literal wildcard `"*"`. Nothing fuzzier on purpose: a grandfathered
 * defect should name the page and the node it lives on, so that fixing one page
 * does not silently keep suppressing the same rule everywhere else.
 */
export function matchesAllowEntry(entry: AllowEntry, finding: Finding): boolean {
	if (entry.rule !== finding.rule) return false;
	if (entry.page !== "*" && entry.page !== finding.page) return false;
	return entry.selector === "*" || entry.selector === finding.selector;
}

/**
 * Split findings into build-failing, warning-only, and suppressed, and report
 * allowlist entries that matched nothing. A stale entry is itself a failure —
 * that is what keeps the ratchet pointing down.
 */
export function triage(findings: readonly Finding[], allowlist: Allowlist): Triage {
	const out: Triage = { failures: [], warnings: [], allowed: [], staleEntries: [] };
	const used = new Set<number>();
	for (const finding of findings) {
		const index = allowlist.allow.findIndex((e) => matchesAllowEntry(e, finding));
		if (index !== -1) {
			used.add(index);
			out.allowed.push(finding);
			continue;
		}
		(isFailingImpact(finding.impact) ? out.failures : out.warnings).push(finding);
	}
	out.failures.sort(compareFindings);
	out.warnings.sort(compareFindings);
	allowlist.allow.forEach((entry, i) => {
		if (!used.has(i)) out.staleEntries.push(entry);
	});
	return out;
}

export interface FindingGroup {
	rule: string;
	impact: Impact;
	selector: string;
	help: string;
	helpUrl: string;
	pages: string[];
}

/**
 * Collapse findings that are the same defect repeated across pages. A site
 * template flaw shows up on all 60 pages; printing 60 identical stanzas buries
 * the one page-specific bug underneath. Grouped by rule + selector so the
 * output stays diagnosable — the page list is kept, not summarised away.
 */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
	const groups = new Map<string, FindingGroup>();
	for (const f of findings) {
		const key = `${f.rule} ${f.selector}`;
		const existing = groups.get(key);
		if (existing) {
			if (!existing.pages.includes(f.page)) existing.pages.push(f.page);
			continue;
		}
		groups.set(key, {
			rule: f.rule,
			impact: f.impact,
			selector: f.selector,
			help: f.help,
			helpUrl: f.helpUrl,
			pages: [f.page],
		});
	}
	return [...groups.values()].sort(
		(a, b) =>
			IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
			b.pages.length - a.pages.length ||
			(a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
	);
}

/**
 * `maxPages` caps the page list for warnings; failures pass `Infinity` so a
 * build-breaking violation always names every page it is on.
 */
export function formatGroup(g: FindingGroup, maxPages = Number.POSITIVE_INFINITY): string {
	const shown = g.pages.slice(0, maxPages);
	const rest = g.pages.length - shown.length;
	const pages = shown.join(", ") + (rest > 0 ? `, … +${rest} more` : "");
	return [
		`${g.impact.toUpperCase().padEnd(8)} ${g.rule}  (${g.pages.length} page(s))`,
		`    selector: ${g.selector}`,
		`    pages:    ${pages}`,
		`    fix:      ${g.help} (${g.helpUrl})`,
	].join("\n");
}

export function findHtmlPages(distDir: string): string[] {
	const pages: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const st = statSync(full);
			if (st.isDirectory()) walk(full);
			else if (st.isFile() && entry.endsWith(".html")) {
				pages.push(relative(distDir, full).replaceAll("\\", "/"));
			}
		}
	};
	if (existsSync(distDir)) walk(distDir);
	return pages.sort();
}

interface AxeNode {
	target: unknown[];
	html: string;
}
interface AxeResult {
	id: string;
	impact: unknown;
	help: string;
	helpUrl: string;
	nodes: AxeNode[];
}
interface AxeRun {
	violations: AxeResult[];
	incomplete: AxeResult[];
}
interface AxeWindow {
	eval: (source: string) => void;
	axe: { run: (context: unknown, options: unknown) => Promise<AxeRun> };
}

export interface PageAudit {
	findings: Finding[];
	incomplete: string[];
}

async function auditPage(page: string, html: string): Promise<PageAudit> {
	const dom = new JSDOM(html, {
		url: `https://warren.run/${page}`,
		runScripts: "outside-only",
		pretendToBeVisual: true,
		virtualConsole: new VirtualConsole(),
	});
	try {
		const win = dom.window as unknown as AxeWindow;
		win.eval(AXE_SOURCE);
		const run = await win.axe.run(dom.window.document, {
			resultTypes: ["violations", "incomplete"],
		});
		const findings: Finding[] = [];
		for (const result of run.violations) {
			for (const node of result.nodes) {
				findings.push({
					page,
					rule: result.id,
					impact: normalizeImpact(result.impact),
					selector: node.target.map((t) => String(t)).join(" "),
					help: result.help,
					helpUrl: result.helpUrl,
				});
			}
		}
		return { findings, incomplete: run.incomplete.map((r) => r.id) };
	} finally {
		dom.window.close();
	}
}

function parseArgs(argv: readonly string[]): { dist: string; allowlist: string } {
	let dist = DEFAULT_DIST;
	let allowlist = DEFAULT_ALLOWLIST;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--dist") dist = resolve(argv[++i] ?? "");
		else if (argv[i] === "--allowlist") allowlist = resolve(argv[++i] ?? "");
	}
	return { dist, allowlist };
}

function reportIncomplete(counts: Map<string, number>, pageCount: number): void {
	if (counts.size === 0) return;
	console.log("\nRules axe could not decide under jsdom (no layout) — NOT covered by this gate:");
	for (const [rule, n] of [...counts].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${rule} — ${n}/${pageCount} pages`);
	}
}

/** `null` when the file disappeared between the directory scan and this read. */
export function readHtml(absPath: string): string | null {
	try {
		return readFileSync(absPath, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/** Exits non-zero rather than returning when a precondition is unmet. */
function requireInputs(dist: string): string[] {
	if (!existsSync(dist)) {
		console.error(`a11y guard: ${dist} does not exist. Run \`bun run build\` first.`);
		process.exit(1);
	}
	const pages = findHtmlPages(dist);
	if (pages.length === 0) {
		console.error(`a11y guard: no .html pages under ${dist}.`);
		process.exit(1);
	}
	return pages;
}

function reportPass(result: Triage, allowlistPath: string): void {
	if (result.warnings.length > 0) {
		const groups = groupFindings(result.warnings);
		console.log(
			`\n${result.warnings.length} moderate/minor issue(s) in ${groups.length} group(s) — reported, not failing:`,
		);
		for (const g of groups) console.log(`  ${formatGroup(g, 3)}`);
	}
	if (result.allowed.length > 0) {
		console.log(`\n${result.allowed.length} issue(s) suppressed by ${allowlistPath}.`);
	}
}

function reportFail(result: Triage): void {
	if (result.staleEntries.length > 0) {
		console.error("\na11y allowlist has entries that matched nothing this run:");
		for (const e of result.staleEntries) console.error(`  ${e.rule} on ${e.page} (${e.selector})`);
		console.error("The ratchet only goes down — delete these entries.");
	}
	if (result.failures.length > 0) {
		console.error(`\na11y guard failed — ${result.failures.length} serious/critical violation(s):`);
		for (const g of groupFindings(result.failures)) console.error(`  ${formatGroup(g)}`);
		console.error(
			"\nFix the markup. Grandfathering into budgets/a11y-allowlist.json is a last resort " +
				"and every entry needs a reason a reviewer would accept.",
		);
	}
}

async function main(): Promise<void> {
	const { dist, allowlist: allowlistPath } = parseArgs(process.argv.slice(2));
	const pages = requireInputs(dist);

	const started = Date.now();
	const findings: Finding[] = [];
	const incomplete = new Map<string, number>();
	const skipped: string[] = [];
	for (const page of pages) {
		// A rebuild racing this sweep can delete a page between the directory
		// scan and this read. In CI nothing else writes dist/ so it cannot
		// happen; locally, several agents build at once. Skip loudly rather
		// than dying with a stack trace, and never pretend the page passed.
		const html = readHtml(join(dist, page));
		if (html === null) {
			skipped.push(page);
			continue;
		}
		const audit = await auditPage(page, html);
		findings.push(...audit.findings);
		for (const rule of audit.incomplete) incomplete.set(rule, (incomplete.get(rule) ?? 0) + 1);
	}

	const result = triage(findings, loadAllowlist(allowlistPath));
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const audited = pages.length - skipped.length;
	console.log(`a11y: axe-core over ${audited} built pages in ${seconds}s.`);
	if (skipped.length > 0) {
		console.log(
			`  ${skipped.length} page(s) vanished mid-run and were NOT audited (concurrent rebuild?): ` +
				`${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ", …" : ""}`,
		);
	}

	reportPass(result, allowlistPath);
	reportIncomplete(incomplete, pages.length);
	reportFail(result);

	if (result.failures.length > 0 || result.staleEntries.length > 0) process.exit(1);
	console.log("\na11y guard ok — no serious or critical violations.");
}

if (import.meta.main) await main();
