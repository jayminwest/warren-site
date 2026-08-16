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
 * Two blocks are lifted out of warren's `src/ui/src/tokens.css` (split out of
 * `index.css` upstream in warren-ac7b, at v0.16.0):
 *
 * 1. `@theme { … }` — Tailwind's token block, rewritten to `:root { … }`.
 *    Tailwind emits an `@theme` block's contents as `:root` custom
 *    properties, so the two are equivalent on a site with no Tailwind.
 * 2. `:root[data-theme="dark"] { … }` — the dark overrides, together with the
 *    comment block directly above them, which explains the keying.
 *
 * Deliberately NOT copied, and asserted by the tests: upstream's
 * `@import "tailwindcss"` line, its `@font-face` rules, its
 * `@custom-variant dark` declaration, and its base-element rules
 * (`html, body`, `*`, the tabular-numerals rule). Upstream keeps those in
 * `index.css`, outside the token file, and the extractor skips them even if
 * they move back in. Those are app concerns; the site declares its own.
 */

/** Upstream path of the stylesheet the tokens are lifted from. */
export const TOKENS_SOURCE = "src/ui/src/tokens.css";

/** Repo-relative path of the file this module generates. */
export const TOKENS_OUT_PATH = "src/styles/warren-theme.css";

/** The Tailwind token block's opening line, at column 0 upstream. */
const THEME_OPENER = "@theme {";

/** The dark-override rule's opening line, at column 0 upstream. */
const DARK_OPENER = ':root[data-theme="dark"] {';

/** What `THEME_OPENER` becomes on a site with no Tailwind. */
const THEME_REPLACEMENT = ":root {";

export type ThemeCssOptions = {
	/** Pinned upstream ref, e.g. `v0.11.0`. Named in the header comment. */
	readonly ref: string;
	/** `<owner>/<repo>`, named in the header comment. */
	readonly repoLabel: string;
	/** Upstream path of the source stylesheet. Defaults to {@link TOKENS_SOURCE}. */
	readonly sourcePath?: string;
};

/** One extracted CSS block: its text, and where it started upstream. */
export type ExtractedBlock = {
	/** The block's lines, joined, with no trailing newline. */
	readonly text: string;
	/** 1-based line number of the block's opening line upstream. */
	readonly startLine: number;
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

/** Count `{` minus `}` on a line, ignoring anything inside a comment. */
function braceDelta(line: string, state: { inComment: boolean }): number {
	const code = stripComments(line, state);
	let delta = 0;
	for (const char of code) {
		if (char === "{") delta++;
		else if (char === "}") delta--;
	}
	return delta;
}

/**
 * Extract the brace-balanced block whose opening line is exactly `opener`.
 *
 * The opener must sit at column 0, which is how upstream writes both blocks.
 * Throws rather than returning a partial block: a missed opener means the
 * upstream stylesheet has been restructured, and a silently-empty token file
 * is far worse than a failed sync.
 */
export function extractBlock(css: string, opener: string): ExtractedBlock {
	const lines = css.split("\n");
	const start = lines.indexOf(opener);
	if (start === -1) {
		throw new Error(
			`sync:upstream: no line \`${opener}\` in ${TOKENS_SOURCE}. warren's stylesheet has ` +
				"been restructured; update scripts/upstream/tokens.ts.",
		);
	}
	const state = { inComment: false };
	let depth = 0;
	for (let index = start; index < lines.length; index++) {
		depth += braceDelta(lines[index] ?? "", state);
		if (depth === 0) {
			return { text: lines.slice(start, index + 1).join("\n"), startLine: start + 1 };
		}
	}
	throw new Error(
		`sync:upstream: the \`${opener}\` block in ${TOKENS_SOURCE} is never closed. ` +
			"Refusing to emit a truncated token file.",
	);
}

/**
 * The comment block sitting directly above `startLine`, if there is one.
 *
 * Upstream keys its dark tokens with a paragraph explaining why the `@media`
 * duplicate went away; that reasoning belongs with the block it describes.
 * Returns `""` when the line above is blank or is not the end of a comment,
 * so a future upstream that drops the comment still syncs cleanly.
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
 * The file header.
 *
 * The wording is the header the file has carried since it was vendored by
 * hand, preserved verbatim so this generator's first output is byte-identical
 * to the committed file. Only the facts inside it move: the ref, the upstream
 * path, and the line the `@theme` block starts on. That last one is derived
 * rather than frozen for the same reason the tokens are — a hard-coded line
 * number becomes a lie the moment upstream inserts a rule above the block.
 *
 * Line 1 is a Biome directive, not prose: the declarations are upstream's and
 * must survive this repo's formatter unchanged.
 */
export function renderHeader(options: ThemeCssOptions, themeStartLine: number): string {
	const source = options.sourcePath ?? TOKENS_SOURCE;
	return `/* biome-ignore-all format: vendored — declarations must stay as upstream wrote them */
/*
 * GENERATED — DO NOT HAND-EDIT. Run \`bun run sync:upstream\`.
 *
 * Source: ${options.repoLabel} \`${source}\` @ ref \`${options.ref}\`
 *         (the \`@theme { … }\` block starting at line ${themeStartLine}, plus the
 *         \`:root[data-theme="dark"]\` override block that follows it).
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
 * ONE mechanical transform is applied on copy, because this site has no
 * Tailwind: the wrapper \`@theme {\` becomes \`:root {\`. Tailwind's \`@theme\`
 * emits its contents as \`:root\` custom properties, so the two are
 * equivalent here; every declaration inside is byte-identical to upstream.
 * Upstream keeps its Tailwind import line, its \`@custom-variant dark\`
 * declaration, and its base-element rules in \`index.css\`, and none of that
 * is copied here. (Spelling that import out literally here would make knip
 * read it as a real dependency.)
 *
 * Theme keying (upstream semantics, preserved): light tokens live on bare
 * \`:root\`, dark tokens on \`:root[data-theme="dark"]\`.
 */`;
}

/**
 * Rewrite the extracted `@theme` block's wrapper to `:root`.
 *
 * Only the opening line changes. Every declaration inside stays byte-identical
 * to upstream, which is the property the header promises and the drift gate
 * enforces.
 */
export function rewriteThemeWrapper(block: string): string {
	if (!block.startsWith(THEME_OPENER)) {
		throw new Error(`sync:upstream: expected the token block to open with \`${THEME_OPENER}\`.`);
	}
	return THEME_REPLACEMENT + block.slice(THEME_OPENER.length);
}

/**
 * The exact bytes `src/styles/warren-theme.css` should hold for a given
 * upstream `index.css`.
 *
 * Header, the rewritten token block, then the dark overrides with the comment
 * that explains them — one blank line between each, trailing newline at the
 * end.
 */
export function renderThemeCss(indexCss: string, options: ThemeCssOptions): string {
	const theme = extractBlock(indexCss, THEME_OPENER);
	const dark = extractBlock(indexCss, DARK_OPENER);
	const comment = precedingComment(indexCss, dark.startLine);
	const darkSection = comment === "" ? dark.text : `${comment}\n${dark.text}`;
	const header = renderHeader(options, theme.startLine);
	return `${header}\n\n${rewriteThemeWrapper(theme.text)}\n\n${darkSection}\n`;
}
