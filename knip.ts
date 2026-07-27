/**
 * knip configuration — the `check:deps` gate (`knip --dependencies`).
 *
 * This is a `.ts` config, not the l5-toolkit's `knip.json`, for one reason:
 * knip reads `.astro` and `.css` files only through a compiler function, and
 * JSON cannot hold a function. On an Astro site most imports live in `.astro`
 * components and in the global stylesheet, so a JSON config would report every
 * such dependency as unused and the gate would be worthless. The two
 * compilers below are knip's documented recipe: pull the import statements out
 * of the file and hand knip that text.
 *
 * When knip reports an unused dependency, the fix is almost always
 * `bun remove <dep>`. Add an entry to `ignoreDependencies` only for a package
 * resolved by string at runtime, and say why on the line above it.
 */

import type { KnipConfig } from "knip";

/** Import statements inside an `.astro` frontmatter block or template. */
const astroImports = (text: string): string => [...text.matchAll(/import[^;]+/g)].join("\n");

/**
 * True for a specifier that resolves through `node_modules` rather than the
 * filesystem: not relative, not absolute, not a URL, not a data/fragment URI.
 */
const isBareSpecifier = (specifier: string): boolean =>
	specifier !== "" && !/^(?:[./#]|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(specifier);

/**
 * The npm package a bare specifier belongs to — `@scope/name` or `name`,
 * dropping any deep subpath. `url()` targets a file INSIDE a package
 * (`@fontsource-variable/inter/files/…woff2`), which no `exports` map has to
 * expose; the package root is the claim knip can actually resolve.
 */
const packageOf = (specifier: string): string => {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

/**
 * Stylesheet dependencies, as import statements knip can parse.
 *
 * Two sources, because knip's built-in css compiler only reads the first:
 *   1. `@import` / `@use` at-rules.
 *   2. `url(...)` targets that are bare specifiers. `src/styles/
 *      starlight-overrides.css` self-hosts its `@font-face` files straight out
 *      of `@fontsource-variable/*` this way, and without them knip reports two
 *      genuinely-used font packages as unused.
 */
const cssImports = (text: string): string => {
	const atRules = [...text.matchAll(/(?<=@)(?:import|use)[^;]+/g)].map((m) => m[0]);
	const urls = [...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
		.map((m) => (m[1] ?? "").trim())
		.filter(isBareSpecifier)
		.map(packageOf);
	return [...atRules, ...[...new Set(urls)].map((pkg) => `import "${pkg}";`)].join("\n");
};

const config: KnipConfig = {
	ignore: ["dist/**", ".astro/**", ".upstream/**", "coverage/**", "test-results/**"],
	compilers: {
		astro: astroImports,
		css: cssImports,
	},
	workspaces: {
		".": {
			entry: ["src/**/*.{ts,astro,mdx}", "scripts/**/*.ts", "**/*.test.ts"],
			project: ["src/**/*.{ts,astro,mdx,css}", "scripts/**/*.ts"],
		},
	},
};

export default config;
