/**
 * Tests for the pure Markdown transforms behind `bun run sync:upstream`.
 *
 * Nothing here reads `.upstream/`, spawns git, or touches the network: every
 * function under test takes strings and returns strings.
 */

import { describe, expect, test } from "bun:test";
import { BLOB_BASE, RAW_BASE } from "../../src/config/upstream.ts";
import {
	deriveDescription,
	EMPTY_TH_CLASS,
	EMPTY_TH_LABEL,
	isAbsoluteHref,
	labelEmptyTableHeaders,
	mapProseLines,
	renderPage,
	resolveUpstreamPath,
	rewriteHref,
	rewriteLinks,
	splitSentences,
	splitTableRow,
	stripInlineMarkdown,
	stripLeadingH1,
	yamlString,
} from "./markdown.ts";

const SLUGS = new Map([
	["README.md", "quickstart"],
	["docs/RUNBOOK-K8S.md", "self-host/kubernetes"],
]);

const REWRITE = {
	sourcePath: "docs/RUNBOOK-K8S.md",
	slugBySource: SLUGS,
	blobBase: BLOB_BASE,
	rawBase: RAW_BASE,
} as const;

describe("stripLeadingH1", () => {
	test("removes the title heading and the blank lines under it", () => {
		expect(stripLeadingH1("# Title\n\n\nBody text\n")).toBe("Body text\n");
	});

	test("removes an H1 that sits below a raw HTML banner", () => {
		const input = '<p align="center">\n  <img src="logo.png">\n</p>\n\n# Warren\n\nBody\n';
		expect(stripLeadingH1(input)).toBe(
			'<p align="center">\n  <img src="logo.png">\n</p>\n\nBody\n',
		);
	});

	test("leaves a document whose first heading is an H2 untouched", () => {
		const input = "Intro\n\n## Section\n\n# Late H1\n";
		expect(stripLeadingH1(input)).toBe(input);
	});

	test("ignores a comment that looks like an H1 inside a fence", () => {
		const input = "```sh\n# not a heading\n```\n\n# Real\n\nBody\n";
		expect(stripLeadingH1(input)).toBe("```sh\n# not a heading\n```\n\nBody\n");
	});

	test("is a no-op when there is no heading at all", () => {
		expect(stripLeadingH1("just prose\n")).toBe("just prose\n");
	});
});

describe("resolveUpstreamPath", () => {
	test("resolves a sibling path relative to the source directory", () => {
		expect(resolveUpstreamPath("docs/RUNBOOK-K8S.md", "deploy/gke.md")).toBe("docs/deploy/gke.md");
	});

	test("resolves a parent path", () => {
		expect(resolveUpstreamPath("docs/RUNBOOK-K8S.md", "../README.md")).toBe("README.md");
	});

	test("resolves an explicit ./ prefix", () => {
		expect(resolveUpstreamPath("docs/design/a.md", "./b.md")).toBe("docs/design/b.md");
	});

	test("resolves against the repo root for a top-level source", () => {
		expect(resolveUpstreamPath("README.md", "docs/labels.md")).toBe("docs/labels.md");
	});

	test("returns undefined when the path escapes the repository", () => {
		expect(resolveUpstreamPath("README.md", "../elsewhere.md")).toBeUndefined();
	});
});

describe("isAbsoluteHref", () => {
	test.each([
		["https://example.com", true],
		["mailto:a@b.c", true],
		["//cdn.example.com/x.png", true],
		["#anchor", true],
		["docs/x.md", false],
		["../README.md", false],
	])("%s -> %s", (href, expected) => {
		expect(isAbsoluteHref(href)).toBe(expected);
	});
});

describe("rewriteHref", () => {
	test("keeps a bare anchor", () => {
		expect(rewriteHref("#scale-out", "link", REWRITE)).toBe("#scale-out");
	});

	test("keeps an external URL", () => {
		expect(rewriteHref("https://bun.sh", "link", REWRITE)).toBe("https://bun.sh");
	});

	test("maps a manifest doc to an internal route", () => {
		expect(rewriteHref("../README.md", "link", REWRITE)).toBe("/docs/quickstart/");
	});

	test("preserves a hash when mapping to an internal route", () => {
		expect(rewriteHref("../README.md#status", "link", REWRITE)).toBe("/docs/quickstart/#status");
	});

	test("maps a non-manifest path to the blob base", () => {
		expect(rewriteHref("design/k8s.md", "link", REWRITE)).toBe(`${BLOB_BASE}/docs/design/k8s.md`);
	});

	test("preserves a hash on a blob URL", () => {
		expect(rewriteHref("../SPEC.md#43-flow", "link", REWRITE)).toBe(`${BLOB_BASE}/SPEC.md#43-flow`);
	});

	test("preserves a query string", () => {
		expect(rewriteHref("../x.md?plain=1", "link", REWRITE)).toBe(`${BLOB_BASE}/x.md?plain=1`);
	});

	test("sends an image to the raw base, because blob serves HTML", () => {
		expect(rewriteHref("../branding/logo.png", "image", REWRITE)).toBe(
			`${RAW_BASE}/branding/logo.png`,
		);
	});

	test("leaves an href that escapes the repository untouched", () => {
		expect(rewriteHref("../../outside.md", "link", { ...REWRITE, sourcePath: "README.md" })).toBe(
			"../../outside.md",
		);
	});

	test("leaves an empty href untouched", () => {
		expect(rewriteHref("", "link", REWRITE)).toBe("");
	});
});

describe("rewriteLinks", () => {
	test("rewrites Markdown links and images in prose", () => {
		const input = "See [the readme](../README.md) and ![logo](../branding/logo.png).";
		expect(rewriteLinks(input, REWRITE)).toBe(
			`See [the readme](/docs/quickstart/) and ![logo](${RAW_BASE}/branding/logo.png).`,
		);
	});

	test("rewrites a badge without mangling the nested image link", () => {
		const input = "[![CI](https://img.example/b.svg)](../ROADMAP.md)";
		expect(rewriteLinks(input, REWRITE)).toBe(
			`[![CI](https://img.example/b.svg)](${BLOB_BASE}/ROADMAP.md)`,
		);
	});

	test("rewrites raw HTML img src and a href", () => {
		const input = '<img src="../branding/logo.png"> <a href="../README.md">x</a>';
		expect(rewriteLinks(input, REWRITE)).toBe(
			`<img src="${RAW_BASE}/branding/logo.png"> <a href="/docs/quickstart/">x</a>`,
		);
	});

	test("preserves a link title", () => {
		expect(rewriteLinks('[x](../README.md "Home")', REWRITE)).toBe('[x](/docs/quickstart/ "Home")');
	});

	test("leaves fenced code blocks byte-identical", () => {
		const input = "```sh\ncurl [x](../README.md)\n```\n[y](../README.md)\n";
		expect(rewriteLinks(input, REWRITE)).toBe(
			"```sh\ncurl [x](../README.md)\n```\n[y](/docs/quickstart/)\n",
		);
	});
});

describe("mapProseLines", () => {
	test("skips fenced lines and the fence markers themselves", () => {
		const out = mapProseLines("a\n```\nb\n```\nc", (line) => line.toUpperCase());
		expect(out).toBe("A\n```\nb\n```\nC");
	});
});

describe("yamlString", () => {
	test.each([
		["plain", '"plain"'],
		['has "quotes"', '"has \\"quotes\\""'],
		["back\\slash", '"back\\\\slash"'],
		["two\nlines", '"two\\nlines"'],
	])("quotes %s", (input, expected) => {
		expect(yamlString(input)).toBe(expected);
	});
});

describe("renderPage", () => {
	const base = { title: "T", editUrl: "https://e", banner: "<!-- b -->", body: "Body\n\n\n" };

	test("emits frontmatter, banner, and a trimmed body", () => {
		expect(renderPage(base)).toBe(
			'---\ntitle: "T"\neditUrl: "https://e"\n---\n\n<!-- b -->\n\nBody\n',
		);
	});

	test("includes description between title and editUrl when present", () => {
		expect(renderPage({ ...base, description: "D" })).toContain(
			'title: "T"\ndescription: "D"\neditUrl: "https://e"',
		);
	});
});

describe("stripInlineMarkdown", () => {
	test("unwraps links, drops images, and removes emphasis and code marks", () => {
		const input = "**Bold** `code` [text](url) ![alt](img) _em_";
		expect(stripInlineMarkdown(input)).toBe("Bold code text em");
	});
});

describe("splitSentences", () => {
	test("does not drop text around a mid-word period", () => {
		const input = "One. See .warren/x.yaml here. Three.";
		expect(splitSentences(input)).toEqual(["One.", "See .warren/x.yaml here.", "Three."]);
	});

	test("keeps a trailing fragment with no terminator", () => {
		expect(splitSentences("Done. Tail")).toEqual(["Done.", "Tail"]);
	});
});

describe("deriveDescription", () => {
	test("uses the first paragraph after the title", () => {
		const input =
			"Checklist for configuring a GitHub repository so warren can open PRs.\n\n## Next\n";
		expect(deriveDescription(input)).toBe(
			"Checklist for configuring a GitHub repository so warren can open PRs.",
		);
	});

	test("joins hard-wrapped continuation lines", () => {
		const input =
			"The canonical label set for warren lives\nin the labels file upstream.\n\nMore.\n";
		expect(deriveDescription(input)).toBe(
			"The canonical label set for warren lives in the labels file upstream.",
		);
	});

	test("accumulates sentences until the minimum length is reached", () => {
		const input =
			"Taste, compiled. This document is the standard that merged work is measured on.\n";
		expect(deriveDescription(input)).toBe(
			"Taste, compiled. This document is the standard that merged work is measured on.",
		);
	});

	test("skips a leading raw HTML block", () => {
		const html = '<p align="center">\n  <img src="l.png">\n</p>\n\n';
		const prose = "Spawn cloud agents at your GitHub repos and get a branch back.";
		expect(deriveDescription(`${html}${prose}\n`)).toBe(prose);
	});

	test("returns undefined for a metadata block", () => {
		expect(
			deriveDescription("**Status:** Design — the seam that unblocks the migration.\n"),
		).toBeUndefined();
	});

	test("returns undefined when the opening prose is too short", () => {
		expect(deriveDescription("Short. \n")).toBeUndefined();
	});

	test("returns undefined when the first sentence overshoots the cap", () => {
		expect(deriveDescription(`${"word ".repeat(60)}end.\n`)).toBeUndefined();
	});

	test("returns undefined for a document that opens with a list", () => {
		expect(deriveDescription("- one\n- two\n")).toBeUndefined();
	});
});

describe("splitTableRow", () => {
	test("drops the structural outer pipes", () => {
		expect(splitTableRow("| a | b |")).toEqual([" a ", " b "]);
	});

	test("keeps an escaped pipe inside its cell", () => {
		expect(splitTableRow("| a \\| b | c |")).toEqual([" a \\| b ", " c "]);
	});

	test("preserves empty cells", () => {
		expect(splitTableRow("| a | |")).toEqual([" a ", " "]);
	});
});

describe("labelEmptyTableHeaders", () => {
	const FILL = `<span class="${EMPTY_TH_CLASS}">${EMPTY_TH_LABEL}</span>`;

	test("labels an empty header cell", () => {
		const input = ["| Drop | |", "|---|---|", "| `BURROW_API_TOKEN` | not read |"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(
			[`| Drop | ${FILL} |`, "|---|---|", "| `BURROW_API_TOKEN` | not read |"].join("\n"),
		);
	});

	test("leaves a fully-labelled header untouched", () => {
		const input = ["| Item | Status |", "|---|---|", "| kubectl | v1.36.2 |"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(input);
	});

	test("leaves an empty BODY cell alone", () => {
		const input = ["| Item | Status |", "|---|---|", "| kubectl | |"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(input);
	});

	test("ignores a pipe row that has no delimiter under it", () => {
		const input = ["| not | a table |", "prose"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(input);
	});

	test("handles an alignment delimiter row", () => {
		const input = ["| | Value |", "| :---: | ---: |", "| a | b |"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(
			[`| ${FILL} | Value |`, "| :---: | ---: |", "| a | b |"].join("\n"),
		);
	});

	test("labels every empty cell in the header", () => {
		const input = ["| | |", "|---|---|", "| a | b |"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(
			[`| ${FILL} | ${FILL} |`, "|---|---|", "| a | b |"].join("\n"),
		);
	});

	test("passes fenced code through byte for byte", () => {
		const input = ["```", "| Drop | |", "|---|---|", "```"].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(input);
	});

	test("labels every table in a document", () => {
		const input = [
			"| A | |",
			"|---|---|",
			"| x | y |",
			"",
			"| B | |",
			"|---|---|",
			"| p | q |",
		].join("\n");
		expect(labelEmptyTableHeaders(input)).toBe(
			[
				`| A | ${FILL} |`,
				"|---|---|",
				"| x | y |",
				"",
				`| B | ${FILL} |`,
				"|---|---|",
				"| p | q |",
			].join("\n"),
		);
	});
});
