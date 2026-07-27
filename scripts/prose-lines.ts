/**
 * Markdown -> prose lines, for the prose guard (`scripts/check-prose.ts`).
 *
 * One job: reduce a markdown document to the sentences a reader actually
 * reads, each tagged with its 1-based source line so a violation can be
 * pointed at. What survives and what does not is the whole content of this
 * module; the STE rules themselves live in `check-prose.ts` and read only the
 * output of `proseLines`.
 *
 * Dropped: fenced code, indented code, headings, table rows, raw HTML,
 * horizontal rules, inline code (replaced by `CODE`), URLs (replaced by
 * `URL`), and link targets — link TEXT survives, because a reader reads it.
 *
 * Kept, and this is the part that is easy to get wrong: YAML frontmatter
 * string scalars. See `frontmatterLines`.
 */

import { frontmatterScalars } from "./prose-frontmatter.ts";

export type ProseLine = { line: number; text: string; isList: boolean };

/** Non-prose markdown lines: headings, table rows, HTML, rules, indented code. */
function isNonProse(raw: string, trimmed: string): boolean {
	return (
		trimmed === "" ||
		trimmed.startsWith("#") ||
		trimmed.startsWith("|") ||
		trimmed.startsWith("<") ||
		/^\s{4,}\S/.test(raw) ||
		/^[-=]{3,}$/.test(trimmed)
	);
}

/** Strip inline markdown so only the sentence text remains. */
function stripInline(trimmed: string): string {
	return trimmed
		.replace(/`[^`]*`/g, " CODE ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, " URL ")
		.replace(/^\s*>\s?/, "")
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Track the two markdown block states the BODY scan must not read as prose:
 * YAML frontmatter and fenced code. Returns true while inside either.
 *
 * Frontmatter is skipped here because it needs YAML parsing, not markdown
 * parsing; `frontmatterLines` reads it separately and its string scalars are
 * linted like any other prose.
 */
function makeBlockSkipper(): (index: number, trimmed: string) => boolean {
	let inFence = false;
	let inFrontmatter = false;

	return (index, trimmed) => {
		if (index === 0 && trimmed === "---") {
			inFrontmatter = true;
			return true;
		}
		if (inFrontmatter) {
			if (trimmed === "---") inFrontmatter = false;
			return true;
		}
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inFence = !inFence;
			return true;
		}
		return inFence;
	};
}

/**
 * Prose lines from the document's YAML frontmatter.
 *
 * Reading the block is `prose-frontmatter.ts`'s job; this only reduces each
 * scalar to prose the way a body line is reduced.
 *
 * Each scalar is reported as a list item. A frontmatter field is an
 * independent value, not a sentence in a flowing paragraph, so folding
 * neighbouring fields together and measuring paragraph length across them
 * would be meaningless.
 */
export function frontmatterLines(lines: readonly string[]): ProseLine[] {
	const out: ProseLine[] = [];
	for (const { line, scalar } of frontmatterScalars(lines)) {
		const text = stripInline(scalar);
		if (text !== "") out.push({ line, text, isList: true });
	}
	return out;
}

export function proseLines(markdown: string): ProseLine[] {
	const lines = markdown.split("\n");
	const out = frontmatterLines(lines);
	const inBlock = makeBlockSkipper();

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();
		if (inBlock(i, trimmed) || isNonProse(raw, trimmed)) continue;

		const text = stripInline(trimmed);
		if (text === "") continue;

		out.push({ line: i + 1, text, isList: /^(?:[-*+]|\d+[.)])\s+/.test(trimmed) });
	}
	return out;
}
