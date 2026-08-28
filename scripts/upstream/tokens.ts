/**
 * Pure extraction of warren's design tokens, used by `bun run sync:upstream`.
 *
 * `src/styles/warren-theme.css` is warren's token set, not this site's. It was
 * hand-copied once; this module makes it a DERIVED artifact so the pipeline
 * that already guards the docs pages guards the tokens too. Without it the
 * site silently keeps rendering last year's colors after warren changes them,
 * which is the exact failure the derive-from-upstream design exists to stop.
 *
 * Everything here takes strings and returns strings — no filesystem, no
 * network, no checkout — so the whole module is unit-testable. The impure
 * shell lives in `scripts/sync-upstream.ts`.
 *
 * WHY STRUCTURAL, NOT LITERAL. The first version of this module looked for
 * two exact opening lines (`@theme {` and `:root[data-theme="dark"] {`) and
 * threw when either was missing. Warren restructured its stylesheet at
 * v0.19.0 (dark-first `:root`, light overrides, a compat layer, new `@theme`
 * wiring) and the sync broke — the third such breakage. This version keys on
 * STRUCTURE instead: it walks every top-level construct in the stylesheet
 * and vendors the ones that carry tokens, in upstream order:
 *
 *   - any rule whose selector mentions `:root` — copied verbatim, along with
 *     the comment block sitting directly above it;
 *   - any `@media` block that contains a `:root` rule (theme fallbacks) —
 *     copied verbatim;
 *   - a static `@theme { … }` block — copied with its wrapper rewritten to
 *     `:root { … }`. Tailwind emits an `@theme` block's contents as `:root`
 *     custom properties, so the two are equivalent on a site with no
 *     Tailwind.
 *
 * Deliberately SKIPPED, wherever they sit: `@theme inline` (Tailwind wiring
 * whose declarations are self-referential without Tailwind), `@import`,
 * `@font-face`, `@custom-variant`, and every base-element rule (`html, body`,
 * `*`, …). Those are app concerns; the site declares its own.
 *
 * The module still fails loudly rather than emitting garbage: it throws when
 * the stylesheet yields no `:root` token block at all, and when a block is
 * never closed — a silently-empty token file is far worse than a failed sync.
 */

/** Upstream path of the stylesheet the tokens are lifted from. */
export const TOKENS_SOURCE = "src/ui/src/tokens.css";

/** Repo-relative path of the file this module generates. */
export const TOKENS_OUT_PATH = "src/styles/warren-theme.css";

export type ThemeCssOptions = {
	/** Pinned upstream ref, e.g. `v0.11.0`. Named in the header comment. */
	readonly ref: string;
	/** `<owner>/<repo>`, named in the header comment. */
	readonly repoLabel: string;
	/** Upstream path of the source stylesheet. Defaults to {@link TOKENS_SOURCE}. */
	readonly sourcePath?: string;
};

/** One top-level CSS construct: a rule/at-rule block or a lone statement. */
export type TopLevelConstruct = {
	/** The construct's lines, joined, with no trailing newline. */
	readonly text: string;
	/** 1-based line number of the construct's first line upstream. */
	readonly startLine: number;
	/** Everything before the first `{`, comment-stripped, whitespace-normalized. */
	readonly prelude: string;
	/** `statement` for brace-less at-rules like `@import "x";`. */
	readonly kind: "block" | "statement";
};

/**
 * Blank out `/* … *\/` comment spans on one line so brace counting cannot be
 * thrown off by a brace inside prose. `state` carries the open/closed status
 * across lines, because upstream's comments are multi-line.
 */
function stripComments(line: string, state: { inComment: boolean }): string {
	let out = "";
	let index = 0;
	while (index < line.length) {
		if (state.inComment) {
			const close = line.indexOf("*/", index);
			if (close === -1) return out;
			state.inComment = false;
			index = close + 2;
			continue;
		}
		const open = line.indexOf("/*", index);
		if (open === -1) return out + line.slice(index);
		out += line.slice(index, open);
		state.inComment = true;
		index = open + 2;
	}
	return out;
}

/** Count `{` minus `}` in already-comment-stripped text. */
function braceDelta(code: string): number {
	let delta = 0;
	for (const char of code) {
		if (char === "{") delta++;
		else if (char === "}") delta--;
	}
	return delta;
}

/**
 * Split a stylesheet into its top-level constructs, in order.
 *
 * Comment-only and blank lines between constructs belong to no construct;
 * {@link precedingComment} recovers a construct's doc comment when the caller
 * wants it. Throws when a block is still open at end of input, so a truncated
 * upstream file can never round-trip into a truncated token file.
 */
/** Mutable scan state for the construct currently being read. */
type Scan = { start: number; prelude: string; sawBrace: boolean };

/**
 * Fold one comment-stripped line into the prelude being accumulated.
 * Reports when the line opened the construct's block, or closed a
 * brace-less statement, so the caller can finish the construct.
 */
function extendPrelude(scan: Scan, code: string): "opened-block" | "ended-statement" | "continue" {
	const bracePos = code.indexOf("{");
	const preludePart = bracePos === -1 ? code : code.slice(0, bracePos);
	scan.prelude = `${scan.prelude} ${preludePart}`.replace(/\s+/g, " ").trim();
	if (bracePos !== -1) {
		scan.sawBrace = true;
		return "opened-block";
	}
	return code.includes(";") ? "ended-statement" : "continue";
}

function finishConstruct(
	lines: readonly string[],
	scan: Scan,
	endIndex: number,
	kind: TopLevelConstruct["kind"],
): TopLevelConstruct {
	return {
		text: lines.slice(scan.start, endIndex + 1).join("\n"),
		startLine: scan.start + 1,
		prelude: kind === "statement" ? scan.prelude.replace(/;.*$/, "").trim() : scan.prelude,
		kind,
	};
}

export function parseTopLevelConstructs(css: string): TopLevelConstruct[] {
	const lines = css.split("\n");
	const state = { inComment: false };
	const out: TopLevelConstruct[] = [];
	let scan: Scan | undefined;
	let depth = 0;
	for (let index = 0; index < lines.length; index++) {
		const code = stripComments(lines[index] ?? "", state);
		if (scan === undefined) {
			if (code.trim() === "") continue;
			scan = { start: index, prelude: "", sawBrace: false };
		}
		if (!scan.sawBrace && extendPrelude(scan, code) === "ended-statement") {
			out.push(finishConstruct(lines, scan, index, "statement"));
			scan = undefined;
			continue;
		}
		depth += braceDelta(code);
		if (scan.sawBrace && depth === 0) {
			out.push(finishConstruct(lines, scan, index, "block"));
			scan = undefined;
		}
	}
	if (scan !== undefined) {
		throw new Error(
			`sync:upstream: a block opening near line ${scan.start + 1} of ${TOKENS_SOURCE} is ` +
				"never closed. Refusing to emit a truncated token file.",
		);
	}
	return out;
}

/** How a construct is vendored: copied, wrapper-rewritten, or left behind. */
export type VendorAction = "verbatim" | "rewrite-theme" | "skip";

/**
 * Decide what to do with one top-level construct.
 *
 * The rules are structural so an upstream reshuffle — new blocks, reordered
 * blocks, inverted theme keying — syncs without edits here. Only a stylesheet
 * with NO `:root` tokens at all fails the sync (see {@link renderThemeCss}).
 */
export function classify(construct: TopLevelConstruct): VendorAction {
	if (construct.kind === "statement") return "skip";
	const prelude = construct.prelude;
	if (prelude.startsWith("@theme inline")) return "skip";
	if (prelude.startsWith("@theme")) return "rewrite-theme";
	if (prelude.startsWith("@media")) {
		return construct.text.includes(":root") ? "verbatim" : "skip";
	}
	if (prelude.startsWith("@")) return "skip";
	return prelude.includes(":root") ? "verbatim" : "skip";
}

/**
 * The comment block sitting directly above `startLine`, if there is one.
 *
 * Upstream keys its theme blocks with paragraphs explaining the keying; that
 * reasoning belongs with the block it describes. Returns `""` when the line
 * above is blank or is not the end of a comment, so a block with no doc
 * comment still syncs cleanly.
 */
export function precedingComment(css: string, startLine: number): string {
	const lines = css.split("\n");
	const end = startLine - 2;
	if (end < 0 || !(lines[end] ?? "").trimEnd().endsWith("*/")) return "";
	for (let index = end; index >= 0; index--) {
		if ((lines[index] ?? "").trimStart().startsWith("/*")) {
			return lines.slice(index, end + 1).join("\n");
		}
	}
	return "";
}

/**
 * Rewrite a `@theme` block's wrapper to `:root`.
 *
 * Only the text before the opening brace changes. Every declaration inside
 * stays byte-identical to upstream, which is the property the header promises
 * and the drift gate enforces.
 */
export function rewriteThemeWrapper(block: string): string {
	const brace = block.indexOf("{");
	if (brace === -1 || !block.slice(0, brace).trimStart().startsWith("@theme")) {
		throw new Error("sync:upstream: expected a `@theme` block to rewrite to `:root`.");
	}
	return `:root ${block.slice(brace)}`;
}

/**
 * The file header.
 *
 * Line 1 is a Biome directive, not prose: the declarations are upstream's and
 * must survive this repo's formatter unchanged.
 */
export function renderHeader(options: ThemeCssOptions, blockCount: number): string {
	const source = options.sourcePath ?? TOKENS_SOURCE;
	return `/* biome-ignore-all format: vendored — declarations must stay as upstream wrote them */
/*
 * GENERATED — DO NOT HAND-EDIT. Run \`bun run sync:upstream\`.
 *
 * Source: ${options.repoLabel} \`${source}\` @ ref \`${options.ref}\`
 *         (${blockCount} token block(s), vendored structurally: every top-level
 *         rule that puts custom properties on \`:root\`, every \`@media\` theme
 *         fallback, and any static \`@theme { … }\` block rewritten to
 *         \`:root { … }\` — Tailwind emits \`@theme\` contents as \`:root\`
 *         custom properties, so the two are equivalent on a site with no
 *         Tailwind. \`@theme inline\`, \`@import\`, \`@font-face\`,
 *         \`@custom-variant\`, and base-element rules are upstream app
 *         concerns and are never copied.)
 *
 * This file is the warren app's design-token set, derived so the
 * marketing/docs site and the product render the same colors, fonts,
 * radii, and shadows. To take new tokens, bump \`UPSTREAM.ref\` in
 * \`src/config/upstream.ts\` and run \`bun run sync:upstream\`. The
 * \`gen:docs:check\` gate fails when this file drifts from the pinned ref,
 * so a hand-edit here does not survive CI. Never add site-specific tokens
 * to this file. Site-specific work (font faces, Starlight variable
 * mapping, page styling) belongs in \`starlight-overrides.css\` and in
 * component \`<style>\` blocks.
 *
 * Theme keying is upstream's, preserved verbatim — consult the vendored
 * comments below for which selector carries which mode at this ref.
 */`;
}

/**
 * The exact bytes `src/styles/warren-theme.css` should hold for a given
 * upstream stylesheet.
 *
 * Header, then every vendored block in upstream order, each with the comment
 * that documents it — one blank line between sections, trailing newline at
 * the end. Throws when the stylesheet yields no token block: a missed
 * restructure must fail the sync, never publish an empty theme.
 */
export function renderThemeCss(indexCss: string, options: ThemeCssOptions): string {
	const sections: string[] = [];
	for (const construct of parseTopLevelConstructs(indexCss)) {
		const action = classify(construct);
		if (action === "skip") continue;
		const text = action === "rewrite-theme" ? rewriteThemeWrapper(construct.text) : construct.text;
		const comment = precedingComment(indexCss, construct.startLine);
		sections.push(comment === "" ? text : `${comment}\n${text}`);
	}
	const hasTokens = sections.some((section) => /--[\w-]+\s*:/.test(section));
	if (sections.length === 0 || !hasTokens) {
		throw new Error(
			`sync:upstream: no \`:root\` token block found in ${TOKENS_SOURCE}. warren's stylesheet ` +
				"has been restructured beyond recognition; update scripts/upstream/tokens.ts.",
		);
	}
	const header = renderHeader(options, sections.length);
	return `${header}\n\n${sections.join("\n\n")}\n`;
}
