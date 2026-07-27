/**
 * Tests for the design-token extractor behind `bun run sync:upstream`.
 *
 * Nothing here reads `.upstream/`, spawns git, or touches the network. The
 * fixture below mirrors the SHAPE of warren's `src/ui/src/index.css` — the
 * Tailwind import, the font faces, the `@custom-variant`, the `@theme` block,
 * the commented dark overrides, and the base-element rules — with short token
 * values, so each assertion states one property of the transform rather than
 * restating upstream's palette.
 */

import { describe, expect, test } from "bun:test";
import {
	extractBlock,
	precedingComment,
	renderHeader,
	renderThemeCss,
	rewriteThemeWrapper,
	TOKENS_OUT_PATH,
	TOKENS_SOURCE,
} from "./tokens.ts";

const OPTIONS = { ref: "v9.9.9", repoLabel: "jayminwest/warren" } as const;

/** A stand-in for warren's stylesheet, in upstream's own order. */
const INDEX_CSS = `@import "tailwindcss";

@font-face {
	font-family: "Inter Variable";
	src: url("@fontsource-variable/inter/files/inter.woff2") format("woff2-variations");
}

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
	--font-sans: "Inter Variable", sans-serif;

	/* Neutral ramp — hue 264 across both modes. */
	--color-bg: oklch(99% 0.003 264);
	--color-fg: oklch(20% 0.01 264);
}

/*
 * Dark-mode tokens.
 *
 * Same neutral hue family (264) as light, shifted in lightness.
 */
:root[data-theme="dark"] {
	--color-bg: oklch(14% 0.008 264);
	--color-fg: oklch(96% 0.005 264);
}

html,
body {
	background-color: var(--color-bg);
	font-family: var(--font-sans);
}

* {
	border-color: var(--color-border);
}

table,
code {
	font-variant-numeric: tabular-nums;
}
`;

const THEME_OPENER = "@theme {";
const DARK_OPENER = ':root[data-theme="dark"] {';

describe("extractBlock", () => {
	test("returns the whole @theme block and its 1-based start line", () => {
		const block = extractBlock(INDEX_CSS, THEME_OPENER);
		expect(block.startLine).toBe(10);
		expect(block.text.startsWith(THEME_OPENER)).toBe(true);
		expect(block.text.endsWith("}")).toBe(true);
		expect(block.text).toContain("--color-fg: oklch(20% 0.01 264);");
	});

	test("stops at the block's own closing brace, not a later one", () => {
		const block = extractBlock(INDEX_CSS, THEME_OPENER);
		expect(block.text).not.toContain("data-theme");
		expect(block.text).not.toContain("tabular-nums");
		expect(block.text.split("\n")).toHaveLength(7);
	});

	test("extracts the dark-override block separately", () => {
		const block = extractBlock(INDEX_CSS, DARK_OPENER);
		expect(block.text.startsWith(DARK_OPENER)).toBe(true);
		expect(block.text).toContain("--color-bg: oklch(14% 0.008 264);");
	});

	test("ignores braces that appear inside a comment", () => {
		const css = "@theme {\n\t/* a stray { brace } in prose */\n\t--a: 1;\n}\n";
		expect(extractBlock(css, THEME_OPENER).text).toBe(css.trimEnd());
	});

	test("ignores a nested block while counting depth", () => {
		const css = "@theme {\n\t@media (min-width: 1px) {\n\t\t--a: 1;\n\t}\n}\nafter {}\n";
		expect(extractBlock(css, THEME_OPENER).text).not.toContain("after");
	});

	test("requires the opener at column 0, not merely somewhere on the line", () => {
		expect(() => extractBlock("\t@theme {\n}\n", THEME_OPENER)).toThrow(/no line/);
	});

	test("fails loudly when the block is absent", () => {
		expect(() => extractBlock("body { color: red; }\n", THEME_OPENER)).toThrow(
			/has been restructured/,
		);
	});

	test("fails loudly rather than emitting a truncated block", () => {
		expect(() => extractBlock("@theme {\n\t--a: 1;\n", THEME_OPENER)).toThrow(/never closed/);
	});
});

describe("precedingComment", () => {
	test("picks up the comment block directly above the rule", () => {
		const dark = extractBlock(INDEX_CSS, DARK_OPENER);
		const comment = precedingComment(INDEX_CSS, dark.startLine);
		expect(comment.startsWith("/*")).toBe(true);
		expect(comment.trimEnd().endsWith("*/")).toBe(true);
		expect(comment).toContain("Dark-mode tokens.");
	});

	test("returns nothing when a blank line separates rule from comment", () => {
		const css = "/* note */\n\n:root {\n}\n";
		expect(precedingComment(css, 3)).toBe("");
	});

	test("returns nothing when there is no comment at all", () => {
		expect(precedingComment(":root {\n}\n", 1)).toBe("");
	});

	test("returns nothing for a comment terminator with no opener above it", () => {
		expect(precedingComment("*/\n:root {\n}\n", 2)).toBe("");
	});
});

describe("rewriteThemeWrapper", () => {
	test("rewrites only the wrapper and leaves declarations byte-identical", () => {
		const block = extractBlock(INDEX_CSS, THEME_OPENER).text;
		const rewritten = rewriteThemeWrapper(block);
		expect(rewritten.split("\n")[0]).toBe(":root {");
		expect(rewritten.slice(":root {".length)).toBe(block.slice(THEME_OPENER.length));
		expect(rewritten).not.toContain("@theme");
	});

	test("refuses a block that does not open with @theme", () => {
		expect(() => rewriteThemeWrapper(":root {\n}")).toThrow(/expected the token block/);
	});
});

describe("renderHeader", () => {
	test("names the ref, the upstream path, and the derived start line", () => {
		const header = renderHeader({ ...OPTIONS }, 42);
		expect(header).toContain("Source: jayminwest/warren `src/ui/src/index.css`");
		expect(header).toContain("@ ref `v9.9.9`");
		expect(header).toContain("block starting at line 42");
	});

	test("carries the Biome directive on line 1 so the formatter leaves tokens alone", () => {
		expect(renderHeader({ ...OPTIONS }, 1).split("\n")[0]).toBe(
			"/* biome-ignore-all format: vendored — declarations must stay as upstream wrote them */",
		);
	});

	test("defaults the source path to the upstream stylesheet", () => {
		expect(renderHeader({ ...OPTIONS }, 1)).toContain(TOKENS_SOURCE);
		expect(renderHeader({ ...OPTIONS, sourcePath: "other.css" }, 1)).toContain("other.css");
	});
});

/**
 * The CSS below the header comment.
 *
 * The header names `@theme` and `@custom-variant` in prose, so an
 * "is not copied" assertion has to look at the rules, not at the whole file.
 */
function bodyOf(css: string): string {
	const end = "\n */\n\n";
	return css.slice(css.indexOf(end) + end.length);
}

describe("renderThemeCss", () => {
	const css = renderThemeCss(INDEX_CSS, OPTIONS);
	const body = bodyOf(css);

	test("emits header, :root block, then the commented dark overrides", () => {
		expect(css.indexOf("VENDORED")).toBeLessThan(css.indexOf(":root {"));
		expect(css.indexOf(":root {")).toBeLessThan(css.indexOf("Dark-mode tokens."));
		expect(css.indexOf("Dark-mode tokens.")).toBeLessThan(css.indexOf(DARK_OPENER));
		expect(css.endsWith("}\n")).toBe(true);
	});

	test("separates each section with exactly one blank line", () => {
		expect(css).toContain(" */\n\n:root {");
		expect(css).toContain("}\n\n/*\n * Dark-mode tokens.");
	});

	test.each([
		["the Tailwind import", '@import "tailwindcss"'],
		["the font faces", "@font-face"],
		["the dark custom-variant", "@custom-variant"],
		["the @theme wrapper", "@theme"],
		["the html/body base rule", "background-color: var(--color-bg)"],
		["the universal border rule", "border-color: var(--color-border)"],
		["the tabular-numerals rule", "font-variant-numeric"],
	])("does not copy %s", (_label, needle) => {
		expect(body).not.toContain(needle);
	});

	test.each([
		'\t--font-sans: "Inter Variable", sans-serif;',
		"\t--color-bg: oklch(99% 0.003 264);",
		"\t--color-bg: oklch(14% 0.008 264);",
	])("keeps the declaration %j byte-identical to upstream", (line) => {
		expect(css.split("\n")).toContain(line);
	});

	test("is deterministic across runs", () => {
		expect(renderThemeCss(INDEX_CSS, OPTIONS)).toBe(css);
	});

	test("reports the token block's real start line, not a frozen one", () => {
		const shifted = renderThemeCss(`/* an added rule */\n${INDEX_CSS}`, OPTIONS);
		expect(css).toContain("block starting at line 10");
		expect(shifted).toContain("block starting at line 11");
	});

	test("drifts when a single upstream token value changes", () => {
		const drifted = INDEX_CSS.replace("oklch(99% 0.003 264)", "oklch(98% 0.003 264)");
		const after = renderThemeCss(drifted, OPTIONS);
		expect(after).not.toBe(css);
		expect(after).toContain("--color-bg: oklch(98% 0.003 264);");
	});

	test("drifts when the ref changes, so the header cannot go stale", () => {
		expect(renderThemeCss(INDEX_CSS, { ...OPTIONS, ref: "v9.9.10" })).not.toBe(css);
	});

	test("writes to the site's stylesheet path", () => {
		expect(TOKENS_OUT_PATH).toBe("src/styles/warren-theme.css");
	});
});
