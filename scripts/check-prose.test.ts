import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADVISORY_RULES, countable, lint, splitSentences, wordCount } from "./check-prose.ts";
import { expandPatterns } from "./prose-files.ts";
import { frontmatterScalar, yamlScalarText } from "./prose-frontmatter.ts";
import { frontmatterLines, proseLines } from "./prose-lines.ts";

function rules(markdown: string): string[] {
	return lint(markdown, 25).violations.map((v) => v.rule);
}

function countOf(markdown: string, rule: string): number {
	return rules(markdown).filter((r) => r === rule).length;
}

describe("expandPatterns", () => {
	let root = "";

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "prose-expand-"));
		mkdirSync(join(root, "content", "docs"), { recursive: true });
		writeFileSync(join(root, "README.md"), "Prose.\n");
		writeFileSync(join(root, "content", "index.md"), "Prose.\n");
		writeFileSync(join(root, "content", "docs", "deep.md"), "Prose.\n");
		writeFileSync(join(root, "content", "notes.txt"), "not markdown\n");
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("keeps a literal path that exists", () => {
		expect(expandPatterns(["README.md"], root)).toEqual(["README.md"]);
	});

	test("skips a literal path that does not exist", () => {
		expect(expandPatterns(["CONTRIBUTING.md"], root)).toEqual([]);
	});

	test("expands a recursive glob and filters by extension", () => {
		expect(expandPatterns(["content/**/*.md"], root)).toEqual([
			"content/docs/deep.md",
			"content/index.md",
		]);
	});

	test("skips a glob that matches nothing", () => {
		expect(expandPatterns(["missing/**/*.md"], root)).toEqual([]);
	});

	test("de-duplicates overlapping patterns and keeps listed order", () => {
		expect(expandPatterns(["content/index.md", "content/**/*.md", "README.md"], root)).toEqual([
			"content/index.md",
			"content/docs/deep.md",
			"README.md",
		]);
	});
});

describe("proseLines", () => {
	test("drops fenced code blocks", () => {
		const md = "Real prose here.\n\n```ts\nconst x = 1; // don't\n```\n\nMore prose.";
		const texts = proseLines(md).map((l) => l.text);
		expect(texts).toEqual(["Real prose here.", "More prose."]);
	});

	test("drops headings, tables, and html but KEEPS frontmatter text", () => {
		const md =
			"---\ntitle: x; y\n---\n\n# Heading; here\n\n| a | b; c |\n\n<!-- comment; -->\n\nProse.";
		expect(proseLines(md).map((l) => l.text)).toEqual(["x; y", "Prose."]);
	});

	test("keeps link text but drops the target", () => {
		const [first] = proseLines("See [the runbook](https://example.com/a;b) for detail.");
		expect(first?.text).toBe("See the runbook for detail.");
	});

	test("replaces inline code with a placeholder", () => {
		const [first] = proseLines("Run `bun test; echo hi` now.");
		expect(first?.text).toBe("Run CODE now.");
	});

	test("marks list items", () => {
		const lines = proseLines("Intro line.\n- A bullet.\n1. A number.");
		expect(lines.map((l) => l.isList)).toEqual([false, true, true]);
	});

	test("reports 1-based source line numbers", () => {
		const lines = proseLines("# H\n\nFirst.\n\nSecond.");
		expect(lines.map((l) => l.line)).toEqual([3, 5]);
	});
});

describe("splitSentences and wordCount", () => {
	test("splits on terminal punctuation followed by a capital", () => {
		expect(splitSentences("One thing. Two things. Three.")).toHaveLength(3);
	});

	test("does not split on a lowercase continuation after a colon", () => {
		expect(splitSentences("The steps are: connect, then dispatch.")).toHaveLength(1);
	});

	test("counts hyphenated and slashed tokens as one word", () => {
		expect(wordCount("Use the built-in claude-code agent.")).toBe(5);
	});
});

describe("contractions vs possessives", () => {
	test("flags real contractions", () => {
		expect(countOf("Do not worry, it isn't ready and we're late.", "contraction")).toBe(2);
	});

	test("does not flag possessives (STE GR-8 permits them)", () => {
		expect(countOf("Warren's supervisor spawns burrow's daemon.", "contraction")).toBe(0);
	});

	test("flags it's but not its", () => {
		expect(countOf("It's here. Its owner left.", "contraction")).toBe(1);
	});
});

describe("passive voice", () => {
	test("flags agentive passive", () => {
		expect(countOf("The circuits are connected by a switching relay.", "passive-voice")).toBe(1);
	});

	test("does not flag past participle as adjective (STE Rule 3.3)", () => {
		expect(countOf("The unit is fully disassembled.", "passive-voice")).toBe(0);
		expect(countOf("Make sure that the run is completed.", "passive-voice")).toBe(0);
	});

	test("flags an adjectival participle when an agent follows", () => {
		expect(countOf("The run is completed by the reaper.", "passive-voice")).toBe(1);
	});
});

describe("-ing main verbs", () => {
	test("flags a progressive main verb", () => {
		expect(countOf("The supervisor is starting the daemon.", "ing-main-verb")).toBe(1);
	});

	test("does not flag -ing words that are nouns or adjectives", () => {
		expect(countOf("There is nothing here. The file is missing.", "ing-main-verb")).toBe(0);
	});
});

describe("noun stacks", () => {
	test("flags a determiner-anchored stack over three words", () => {
		expect(countOf("Inspect the per-request pino child logger.", "noun-stack(>3)")).toBe(1);
	});

	test("does not flag a three-word stack", () => {
		expect(countOf("Inspect the pino child logger.", "noun-stack(>3)")).toBe(0);
	});

	test("does not run a stack across punctuation", () => {
		expect(countOf("The scheduler: connect, add, spawn, watch.", "noun-stack(>3)")).toBe(0);
	});

	test("requires a determiner anchor", () => {
		expect(countOf("Warren ships built-in claude-code sandbox agents.", "noun-stack(>3)")).toBe(0);
	});

	test("is advisory, not counted toward the budget", () => {
		expect(ADVISORY_RULES.has("noun-stack(>3)")).toBe(true);
		const violations = lint("Inspect the per-request pino child logger.", 25).violations;
		expect(violations).toHaveLength(1);
		expect(countable(violations)).toHaveLength(0);
	});
});

describe("paragraphs", () => {
	test("flags a paragraph over six sentences", () => {
		const md = "A one. B two. C three. D four. E five. F six. G seven.";
		expect(countOf(md, "long-paragraph(>6s)")).toBe(1);
	});

	test("does not flag a six-sentence paragraph", () => {
		expect(countOf("A one. B two. C three. D four. E five. F six.", "long-paragraph(>6s)")).toBe(0);
	});

	test("does not count vertical list items (STE Rule 4.3 wants lists)", () => {
		const md = [
			"- A one.",
			"- B two.",
			"- C three.",
			"- D four.",
			"- E five.",
			"- F six.",
			"- G seven.",
		].join("\n");
		expect(countOf(md, "long-paragraph(>6s)")).toBe(0);
	});
});

describe("other mechanical rules", () => {
	test("flags semicolons", () => {
		expect(countOf("Start the run; then watch it.", "semicolon")).toBe(1);
	});

	test("flags sentences over the cap", () => {
		const long = `The ${"word ".repeat(30)}ends here.`;
		expect(lint(long, 25).violations.some((v) => v.rule.startsWith("long-sentence"))).toBe(true);
	});

	test("respects the configured cap", () => {
		const md = "One two three four five six seven eight nine ten eleven twelve.";
		expect(lint(md, 25).violations.some((v) => v.rule.startsWith("long-sentence"))).toBe(false);
		expect(lint(md, 10).violations.some((v) => v.rule.startsWith("long-sentence"))).toBe(true);
	});

	test("flags Latin abbreviations", () => {
		expect(countOf("Use a tool, e.g. burrow, for this.", "latin-abbreviation")).toBe(1);
	});

	test("flags phrasal verbs", () => {
		expect(countOf("Spin up the sandbox.", "phrasal-verb")).toBe(1);
	});

	test("flags substitution-list words", () => {
		expect(countOf("Ensure the daemon can utilize the socket.", "substitute-word")).toBe(2);
	});

	test("flags marketing adjectives", () => {
		expect(countOf("A seamless and robust control plane.", "marketing-adjective")).toBe(2);
	});

	test("flags nominalizations", () => {
		expect(countOf("Perform an analysis of the log.", "nominalization")).toBe(1);
	});

	test("ignores everything inside code fences", () => {
		const md = "```\nEnsure it isn't seamless; e.g. spin up.\n```";
		expect(lint(md, 25).violations).toHaveLength(0);
	});

	test("counts words only from prose", () => {
		expect(lint("Two words.\n\n```\nignored code here\n```", 25).words).toBe(2);
	});
});

describe("yamlScalarText", () => {
	test.each([
		['"a b"', "a b"],
		["'a b'", "a b"],
		["a b", "a b"],
		['"say \\"hi\\""', 'say "hi"'],
		["'it''s'", "it's"],
	])("reads %s as text", (input, expected) => {
		expect(yamlScalarText(input)).toBe(expected);
	});

	test.each(["2", "-1.5", "1_000", "1e3", "true", "False", "null", "~", "yes", "off"])(
		"rejects the non-text scalar %s",
		(input) => {
			expect(yamlScalarText(input)).toBeUndefined();
		},
	);

	test.each(["|", ">", "|-", ">2", "[a, b]", "{a: b}", "&anchor", "*alias"])(
		"rejects the structural value %s",
		(input) => {
			expect(yamlScalarText(input)).toBeUndefined();
		},
	);
});

describe("frontmatterScalar", () => {
	test("reads a mapping value and never the key", () => {
		expect(frontmatterScalar('headline: "Coolify for coding agents"')).toBe(
			"Coolify for coding agents",
		);
	});

	test("reads a nested mapping value at any indent", () => {
		expect(frontmatterScalar('  label: "Read the quickstart"')).toBe("Read the quickstart");
	});

	test("reads a sequence item", () => {
		expect(frontmatterScalar('  - "One claim."')).toBe("One claim.");
	});

	test("reads block-scalar body text", () => {
		expect(frontmatterScalar("  Warren opens a pull request.")).toBe(
			"Warren opens a pull request.",
		);
	});

	test.each([
		["primaryCta:", "a key with no value"],
		["order: 2", "a number"],
		["draft: true", "a boolean"],
		["# a comment", "a comment"],
		["", "a blank line"],
		["-", "an empty sequence item"],
		["description: >", "a block-scalar header"],
	])("returns undefined for %s (%s)", (input) => {
		expect(frontmatterScalar(input)).toBeUndefined();
	});
});

describe("frontmatterLines", () => {
	const HERO = [
		"---",
		'eyebrow: "Open source"',
		'headline: "Point it at a repository"',
		"order: 2",
		"primaryCta:",
		'  label: "Read the quickstart"',
		'  href: "/docs/quickstart/"',
		"---",
		"",
		"Body prose.",
	];

	test("emits every string scalar with its 1-based source line", () => {
		expect(frontmatterLines(HERO)).toEqual([
			{ line: 2, text: "Open source", isList: true },
			{ line: 3, text: "Point it at a repository", isList: true },
			{ line: 6, text: "Read the quickstart", isList: true },
			{ line: 7, text: "/docs/quickstart/", isList: true },
		]);
	});

	test("stops at the closing delimiter", () => {
		expect(frontmatterLines(HERO).every((l) => l.line < 8)).toBe(true);
	});

	test("returns nothing when the document has no frontmatter", () => {
		expect(frontmatterLines(["Body prose.", "More."])).toEqual([]);
	});

	test("strips inline markdown from a scalar", () => {
		expect(frontmatterLines(["---", 'title: "Run `bun test` now"', "---"])).toEqual([
			{ line: 2, text: "Run CODE now", isList: true },
		]);
	});
});

describe("lint over frontmatter", () => {
	const wrap = (frontmatter: string): string => `---\n${frontmatter}\n---\n\nBody prose.\n`;

	test("flags a marketing adjective in a headline", () => {
		expect(countOf(wrap('headline: "A seamless control plane"'), "marketing-adjective")).toBe(1);
	});

	test("flags a contraction in a CTA label", () => {
		expect(countOf(wrap('cta:\n  label: "Don\'t wait"'), "contraction")).toBe(1);
	});

	test("flags passive voice in a description", () => {
		expect(countOf(wrap('description: "Each run is sandboxed by warren."'), "passive-voice")).toBe(
			1,
		);
	});

	test("counts frontmatter words toward the file total", () => {
		expect(lint(wrap('headline: "Three clean words"'), 25).words).toBe(5);
	});

	test("does not fold neighbouring fields into one paragraph", () => {
		const frontmatter = ["a: One. Two. Three.", "b: One. Two. Three.", "c: One. Two. Three."].join(
			"\n",
		);
		expect(rules(wrap(frontmatter))).not.toContain("long-paragraph(>6s)");
	});

	test("leaves a clean frontmatter block alone", () => {
		const frontmatter = ['eyebrow: "Sandbox"', 'title: "Every run is sandboxed"', "order: 2"].join(
			"\n",
		);
		expect(countable(lint(wrap(frontmatter), 25).violations)).toEqual([]);
	});
});
