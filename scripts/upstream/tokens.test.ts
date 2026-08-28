/**
 * Tests for the design-token extractor behind `bun run sync:upstream`.
 *
 * Nothing here reads `.upstream/`, spawns git, or touches the network. The
 * fixtures below mirror the SHAPE of warren's stylesheet at two real refs —
 * the pre-v0.19 layout (`@theme` + `:root[data-theme="dark"]` overrides) and
 * the v0.19 Direction C layout (dark-first `:root`, light overrides, a media
 * fallback, a compat layer, `@theme inline` wiring) — with short token
 * values, so each assertion states one property of the transform rather than
 * restating upstream's palette. Two shapes, one extractor: the point of the
 * structural rewrite is that BOTH vendor cleanly with no per-ref edits, which
 * is the regression the old exact-opener-line extractor failed (three times).
 */

import { describe, expect, test } from "bun:test";
import {
	classify,
	parseTopLevelConstructs,
	precedingComment,
	renderHeader,
	renderThemeCss,
	rewriteThemeWrapper,
	TOKENS_OUT_PATH,
	TOKENS_SOURCE,
} from "./tokens.ts";

const OPTIONS = { ref: "v9.9.9", repoLabel: "jayminwest/warren" } as const;

/** The pre-v0.19 shape: light on `@theme`, dark on `:root[data-theme="dark"]`. */
const LEGACY_CSS = `@import "tailwindcss";

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

/** The v0.19 Direction C shape: dark-first `:root`, light overrides. */
const DIRECTION_C_CSS = `/*
 * Direction C operator-console design tokens.
 */

:root {
	--color-bg: oklch(14% 0.008 264);
	--color-text: oklch(96% 0.005 264);
	--color-lt-bg: oklch(96.8% 0.004 264);
	--color-lt-text: oklch(22% 0.015 264);
	--font-sans: "Inter Variable", sans-serif;
}

/*
 * Light theme: each base property is reassigned from its lt twin.
 */
:root[data-theme="light"] {
	--color-bg: var(--color-lt-bg);
	--color-text: var(--color-lt-text);
}

/*
 * No data-theme attribute: the OS preference decides.
 */
@media (prefers-color-scheme: light) {
	:root:not([data-theme="dark"]) {
		--color-bg: var(--color-lt-bg);
		--color-text: var(--color-lt-text);
	}
}

/*
 * Compatibility layer (legacy token names -> Direction C base names).
 */
:root {
	--color-fg: var(--color-text);
}

@theme inline {
	--font-sans: var(--font-sans);
	--color-bg: var(--color-bg);
}

@theme {
	--shadow-sm: 0 1px 2px 0 oklch(20% 0.01 264 / 0.06);
	--z-sticky: 10;
}
`;

describe("parseTopLevelConstructs", () => {
	test("finds every top-level construct in the legacy shape, in order", () => {
		const preludes = parseTopLevelConstructs(LEGACY_CSS).map((c) => c.prelude);
		expect(preludes).toEqual([
			'@import "tailwindcss"',
			"@font-face",
			'@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))',
			"@theme",
			':root[data-theme="dark"]',
			"html, body",
			"*",
			"table, code",
		]);
	});

	test("reports 1-based start lines", () => {
		const constructs = parseTopLevelConstructs(LEGACY_CSS);
		expect(constructs[0]?.startLine).toBe(1);
		expect(constructs.find((c) => c.prelude === "@theme")?.startLine).toBe(10);
	});

	test("marks brace-less at-rules as statements", () => {
		const constructs = parseTopLevelConstructs(LEGACY_CSS);
		expect(constructs[0]?.kind).toBe("statement");
		expect(constructs[1]?.kind).toBe("block");
	});

	test("keeps a nested block inside its parent while counting depth", () => {
		const media = parseTopLevelConstructs(DIRECTION_C_CSS).find((c) =>
			c.prelude.startsWith("@media"),
		);
		expect(media?.text).toContain(':root:not([data-theme="dark"])');
		expect(media?.text.trimEnd().endsWith("}")).toBe(true);
	});

	test("ignores braces that appear inside a comment", () => {
		const css = "@theme {\n\t/* a stray { brace } in prose */\n\t--a: 1;\n}\n";
		const constructs = parseTopLevelConstructs(css);
		expect(constructs).toHaveLength(1);
		expect(constructs[0]?.text).toBe(css.trimEnd());
	});

	test("does not treat a comment-only line as a construct", () => {
		const css = "/*\n * banner\n */\n\n:root {\n\t--a: 1;\n}\n";
		const constructs = parseTopLevelConstructs(css);
		expect(constructs).toHaveLength(1);
		expect(constructs[0]?.startLine).toBe(5);
	});

	test("fails loudly rather than returning a truncated block", () => {
		expect(() => parseTopLevelConstructs("@theme {\n\t--a: 1;\n")).toThrow(/never closed/);
	});
});

describe("classify", () => {
	const byPrelude = (css: string, prefix: string) => {
		const construct = parseTopLevelConstructs(css).find((c) => c.prelude.startsWith(prefix));
		if (construct === undefined) throw new Error(`no construct starting ${prefix}`);
		return construct;
	};

	test.each([
		["a bare :root block", ":root"],
		["an attribute-keyed :root block", ':root[data-theme="light"]'],
	])("keeps %s verbatim", (_label, prefix) => {
		expect(classify(byPrelude(DIRECTION_C_CSS, prefix))).toBe("verbatim");
	});

	test("keeps a @media block that carries a :root rule", () => {
		expect(classify(byPrelude(DIRECTION_C_CSS, "@media"))).toBe("verbatim");
	});

	test("rewrites a static @theme block", () => {
		expect(classify(byPrelude(LEGACY_CSS, "@theme"))).toBe("rewrite-theme");
	});

	test("skips @theme inline — its declarations are circular without Tailwind", () => {
		expect(classify(byPrelude(DIRECTION_C_CSS, "@theme inline"))).toBe("skip");
	});

	test.each([
		["the Tailwind import", "@import"],
		["a font face", "@font-face"],
		["the dark custom-variant", "@custom-variant"],
		["the html/body base rule", "html"],
		["the universal rule", "*"],
		["the tabular-numerals rule", "table"],
	])("skips %s", (_label, prefix) => {
		expect(classify(byPrelude(LEGACY_CSS, prefix))).toBe("skip");
	});

	test("skips a @media block with no :root rule inside", () => {
		const css = "@media print {\n\tbody { color: black; }\n}\n";
		expect(classify(byPrelude(css, "@media"))).toBe("skip");
	});
});

describe("precedingComment", () => {
	test("picks up the comment block directly above the rule", () => {
		const dark = parseTopLevelConstructs(LEGACY_CSS).find((c) => c.prelude.startsWith(":root"));
		const comment = precedingComment(LEGACY_CSS, dark?.startLine ?? 0);
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
		const block = parseTopLevelConstructs(LEGACY_CSS).find((c) => c.prelude === "@theme");
		const rewritten = rewriteThemeWrapper(block?.text ?? "");
		expect(rewritten.split("\n")[0]).toBe(":root {");
		const brace = (block?.text ?? "").indexOf("{");
		expect(rewritten.slice(":root ".length)).toBe((block?.text ?? "").slice(brace));
		expect(rewritten).not.toContain("@theme");
	});

	test("refuses a block that does not open with @theme", () => {
		expect(() => rewriteThemeWrapper(":root {\n}")).toThrow(/expected a `@theme` block/);
	});
});

describe("renderHeader", () => {
	test("names the ref, the upstream path, and the vendored block count", () => {
		const header = renderHeader({ ...OPTIONS }, 4);
		expect(header).toContain("Source: jayminwest/warren `src/ui/src/tokens.css`");
		expect(header).toContain("@ ref `v9.9.9`");
		expect(header).toContain("4 token block(s)");
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

describe("renderThemeCss — legacy shape", () => {
	const css = renderThemeCss(LEGACY_CSS, OPTIONS);
	const body = bodyOf(css);

	test("emits header, :root block, then the commented dark overrides", () => {
		expect(css.indexOf("GENERATED")).toBeLessThan(css.indexOf(":root {"));
		expect(css.indexOf(":root {")).toBeLessThan(css.indexOf("Dark-mode tokens."));
		expect(css.indexOf("Dark-mode tokens.")).toBeLessThan(css.indexOf('[data-theme="dark"]'));
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
		expect(renderThemeCss(LEGACY_CSS, OPTIONS)).toBe(css);
	});

	test("drifts when a single upstream token value changes", () => {
		const drifted = LEGACY_CSS.replace("oklch(99% 0.003 264)", "oklch(98% 0.003 264)");
		const after = renderThemeCss(drifted, OPTIONS);
		expect(after).not.toBe(css);
		expect(after).toContain("--color-bg: oklch(98% 0.003 264);");
	});

	test("drifts when the ref changes, so the header cannot go stale", () => {
		expect(renderThemeCss(LEGACY_CSS, { ...OPTIONS, ref: "v9.9.10" })).not.toBe(css);
	});

	test("writes to the site's stylesheet path", () => {
		expect(TOKENS_OUT_PATH).toBe("src/styles/warren-theme.css");
	});
});

describe("renderThemeCss — Direction C shape (the v0.19.0 regression)", () => {
	const css = renderThemeCss(DIRECTION_C_CSS, OPTIONS);
	const body = bodyOf(css);

	test("vendors dark-first :root, light overrides, media fallback, compat layer", () => {
		expect(body).toContain("--color-bg: oklch(14% 0.008 264);");
		expect(body).toContain(':root[data-theme="light"] {');
		expect(body).toContain("@media (prefers-color-scheme: light) {");
		expect(body).toContain("--color-fg: var(--color-text);");
	});

	test("keeps upstream order and each block's doc comment", () => {
		expect(body.indexOf(":root {")).toBeLessThan(body.indexOf("Light theme"));
		expect(body.indexOf("Light theme")).toBeLessThan(body.indexOf("@media"));
		expect(body.indexOf("@media")).toBeLessThan(body.indexOf("Compatibility layer"));
	});

	test("rewrites the static @theme block to :root and keeps its declarations", () => {
		expect(body).toContain("--shadow-sm: 0 1px 2px 0 oklch(20% 0.01 264 / 0.06);");
		expect(body).toContain("--z-sticky: 10;");
		expect(body).not.toContain("@theme");
	});

	test("skips the circular @theme inline wiring", () => {
		expect(body).not.toContain("--font-sans: var(--font-sans);");
	});

	test("counts only vendored blocks in the header", () => {
		expect(css).toContain("5 token block(s)");
	});
});

describe("renderThemeCss — failure modes", () => {
	test("throws when the stylesheet has no :root token block at all", () => {
		expect(() => renderThemeCss("body { color: red; }\n", OPTIONS)).toThrow(
			/restructured beyond recognition/,
		);
	});

	test("throws when the only :root block declares no custom properties", () => {
		expect(() => renderThemeCss(":root {\n\tcolor: red;\n}\n", OPTIONS)).toThrow(
			/restructured beyond recognition/,
		);
	});

	test("throws on a truncated stylesheet", () => {
		expect(() => renderThemeCss(":root {\n\t--a: 1;\n", OPTIONS)).toThrow(/never closed/);
	});
});
