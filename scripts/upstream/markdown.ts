/**
 * Pure Markdown transforms used by `bun run sync:upstream`.
 *
 * Every function here takes strings and returns strings. Nothing reads the
 * filesystem, spawns a process, or touches the network, so the whole module
 * is unit-testable without an upstream checkout. The impure shell lives in
 * `scripts/sync-upstream.ts`.
 *
 * Four transforms turn an upstream Markdown file into a Starlight page:
 *
 * 1. `stripLeadingH1` — Starlight renders the page title from frontmatter,
 *    so the document's own H1 would render a second time.
 * 2. `rewriteLinks` — a relative link is meaningless once the file moves to
 *    this site. See the rule table on `rewriteHref`.
 * 3. `labelEmptyTableHeaders` — an empty header cell upstream becomes an
 *    empty `<th>` here, which is an accessibility defect this site owns.
 * 4. `renderPage` — frontmatter plus the generated-file banner.
 */

import { posix } from "node:path";

/** Fence opener/closer for a Markdown code block. */
const FENCE = /^\s*(?:```|~~~)/;

/** Markdown link or image: `[text](href "title")` / `![alt](src)`. */
const MD_LINK = /(!?)\[((?:[^\][]|\[[^\][]*\])*)\]\(\s*(<[^>]*>|[^()\s]+)((?:\s+"[^"]*")?)\s*\)/g;

/** `src="…"` on a raw HTML `<img>`, which upstream READMEs use for logos. */
const HTML_IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*")([^"]*)(")/gi;

/** `href="…"` on a raw HTML `<a>`. */
const HTML_A_HREF = /(<a\b[^>]*?\bhref\s*=\s*")([^"]*)(")/gi;

export type RewriteOptions = {
	/** Repo-root-relative path of the file being rewritten, e.g. `docs/labels.md`. */
	readonly sourcePath: string;
	/** Repo-root-relative upstream path -> site slug, for the internal-route rule. */
	readonly slugBySource: ReadonlyMap<string, string>;
	/** `https://github.com/<owner>/<repo>/blob/<ref>` — no trailing slash. */
	readonly blobBase: string;
	/** `https://raw.githubusercontent.com/<owner>/<repo>/<ref>` — no trailing slash. */
	readonly rawBase: string;
};

/**
 * Apply `transform` to every line that is NOT inside a fenced code block.
 *
 * Shell samples in warren's docs contain parentheses and brackets that the
 * link regex would happily mangle, so fenced blocks are passed through byte
 * for byte.
 */
export function mapProseLines(markdown: string, transform: (line: string) => string): string {
	const lines = markdown.split("\n");
	let inFence = false;
	const out = lines.map((line) => {
		if (FENCE.test(line)) {
			inFence = !inFence;
			return line;
		}
		return inFence ? line : transform(line);
	});
	return out.join("\n");
}

/**
 * Drop the document's leading H1 and the blank lines that follow it.
 *
 * "Leading" means the first H1 that appears before any lower-level heading.
 * A document whose first heading is an H2 keeps every heading it has.
 */
export function stripLeadingH1(markdown: string): string {
	const lines = markdown.split("\n");
	let inFence = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (/^##+\s/.test(line)) break;
		if (!/^#\s+\S/.test(line)) continue;
		lines.splice(index, 1);
		while ((lines[index] ?? "x").trim() === "") lines.splice(index, 1);
		return lines.join("\n");
	}
	return markdown;
}

/**
 * Resolve a relative href against the source file's directory and normalise
 * it to a repo-root-relative path.
 *
 * Returns `undefined` when the path escapes the repository root, which is
 * always an upstream bug — the caller then leaves the href untouched rather
 * than emitting a URL that 404s.
 */
export function resolveUpstreamPath(sourcePath: string, href: string): string | undefined {
	const base = posix.dirname(sourcePath);
	const joined = posix.normalize(posix.join(base === "." ? "" : base, href));
	const cleaned = joined.replace(/^\.\//, "");
	if (cleaned.startsWith("..") || cleaned === "." || cleaned === "") return undefined;
	return cleaned;
}

/** True for `https:`, `mailto:`, protocol-relative `//host`, and bare anchors. */
export function isAbsoluteHref(href: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("//") || href.startsWith("#");
}

/**
 * Rewrite one href.
 *
 * | Input                                    | Output                        |
 * | ---------------------------------------- | ----------------------------- |
 * | `#section`                               | unchanged                     |
 * | `https://…`, `mailto:…`, `//host/…`      | unchanged                     |
 * | upstream path listed in `UPSTREAM_DOCS`  | `/docs/<slug>/`               |
 * | any other upstream path (`kind: link`)   | `<blobBase>/<path>`           |
 * | any other upstream path (`kind: image`)  | `<rawBase>/<path>`            |
 *
 * A trailing `#hash` or `?query` is preserved on every branch. Images get the
 * raw base because a `blob` URL serves an HTML page, not image bytes.
 */
export function rewriteHref(href: string, kind: "link" | "image", options: RewriteOptions): string {
	if (href === "" || isAbsoluteHref(href)) return href;
	const suffixAt = href.search(/[#?]/);
	const pathPart = suffixAt === -1 ? href : href.slice(0, suffixAt);
	const suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
	if (pathPart === "") return href;
	const resolved = resolveUpstreamPath(options.sourcePath, pathPart);
	if (resolved === undefined) return href;
	const slug = options.slugBySource.get(resolved);
	if (slug !== undefined) return `/docs/${slug}/${suffix}`;
	const base = kind === "image" ? options.rawBase : options.blobBase;
	return `${base}/${resolved}${suffix}`;
}

/** Rewrite every Markdown and raw-HTML href in the prose parts of a document. */
export function rewriteLinks(markdown: string, options: RewriteOptions): string {
	return mapProseLines(markdown, (line) =>
		line
			.replace(MD_LINK, (_match, bang: string, text: string, target: string, title: string) => {
				const bare = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
				const kind = bang === "!" ? "image" : "link";
				return `${bang}[${text}](${rewriteHref(bare, kind, options)}${title})`;
			})
			.replace(HTML_IMG_SRC, (_m, open: string, src: string, close: string) => {
				return `${open}${rewriteHref(src, "image", options)}${close}`;
			})
			.replace(HTML_A_HREF, (_m, open: string, href: string, close: string) => {
				return `${open}${rewriteHref(href, "link", options)}${close}`;
			}),
	);
}

/** A GFM table row: starts and ends with `|` once trimmed. */
const TABLE_ROW = /^\|.*\|$/;

/** The delimiter row directly under a table's header, e.g. `|---|:--:|`. */
const TABLE_DELIMITER = /^\|(?:\s*:?-+:?\s*\|)+$/;

/**
 * CSS class the placeholder header label carries. Defined by this site in
 * `src/styles/starlight-overrides.css` — deliberately NOT Starlight's own
 * `sr-only`, so the rendering cannot change under us when Starlight
 * reorganises its utility classes.
 */
export const EMPTY_TH_CLASS = "sr-th-label";

/**
 * Text used for a column whose header upstream left blank. Generic on
 * purpose: this transform cannot know what the column holds, and inventing a
 * specific name would be restating upstream content by guess. Every such
 * column in warren's docs so far is the explanation half of a two-column
 * term/explanation table.
 */
export const EMPTY_TH_LABEL = "Notes";

/** Markup written into an empty header cell: announced, never displayed. */
const EMPTY_TH_FILL = `<span class="${EMPTY_TH_CLASS}">${EMPTY_TH_LABEL}</span>`;

/**
 * Split one GFM table row into its cells, honouring `\|` escapes.
 *
 * The leading and trailing pipes are structural, so `| a | b |` is two cells,
 * not four.
 */
export function splitTableRow(row: string): string[] {
	const inner = row.trim().slice(1, -1);
	const cells: string[] = [];
	let current = "";
	for (let index = 0; index < inner.length; index++) {
		const char = inner[index];
		if (char === "\\" && inner[index + 1] === "|") {
			current += "\\|";
			index++;
		} else if (char === "|") {
			cells.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	cells.push(current);
	return cells;
}

/**
 * Give every empty table header cell an accessible name.
 *
 * GFM renders the first row of a table as `<th>` unconditionally, so a header
 * cell that upstream left blank — `| Drop (…) | |` in warren's
 * `docs/RUNBOOK-GKE.md` — ships as an empty `<th>`. axe reports that as
 * `empty-table-header`, and warren is read-only from here, so the fix belongs
 * in this pipeline.
 *
 * The label is wrapped in a visually-hidden span: assistive technology gets a
 * usable column name and the rendered table looks exactly as it does
 * upstream. A row is only treated as a header when the line directly below it
 * is a delimiter row, so a body row with an empty cell is left alone. Fenced
 * code is passed through untouched.
 */
export function labelEmptyTableHeaders(markdown: string): string {
	const lines = markdown.split("\n");
	let inFence = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const trimmed = line.trim();
		if (!TABLE_ROW.test(trimmed)) continue;
		if (!TABLE_DELIMITER.test((lines[index + 1] ?? "").trim())) continue;
		const cells = splitTableRow(trimmed);
		if (cells.every((cell) => cell.trim() !== "")) continue;
		lines[index] = `| ${cells
			.map((cell) => (cell.trim() === "" ? EMPTY_TH_FILL : cell.trim()))
			.join(" | ")} |`;
	}
	return lines.join("\n");
}

/** Quote a value as a double-quoted YAML scalar. Safe for any frontmatter field. */
export function yamlString(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

export type PageInput = {
	readonly title: string;
	readonly description?: string | undefined;
	readonly editUrl: string;
	readonly banner: string;
	readonly body: string;
};

/**
 * Assemble a Starlight page: frontmatter, the generated-file banner, body.
 *
 * `editUrl` is written per page on purpose. Starlight builds its edit link
 * from the LOCAL file path, which for derived content points at a file that
 * nobody should edit; the override sends the reader upstream instead.
 */
export function renderPage(input: PageInput): string {
	const fields = [`title: ${yamlString(input.title)}`];
	if (input.description !== undefined) {
		fields.push(`description: ${yamlString(input.description)}`);
	}
	fields.push(`editUrl: ${yamlString(input.editUrl)}`);
	const body = input.body.replace(/\s+$/, "");
	return `---\n${fields.join("\n")}\n---\n\n${input.banner}\n\n${body}\n`;
}

/** Shortest accepted description. Below this the sentence carries no meaning. */
const DESCRIPTION_MIN = 40;
/** Longest accepted description. Search engines truncate near this length. */
const DESCRIPTION_MAX = 180;

/** A line that opens a paragraph of ordinary prose rather than markup. */
const PROSE_START = /^[A-Za-z`*]/;
/** A line that ENDS a paragraph: heading, list item, quote, table, raw HTML. */
const BLOCK_BREAK = /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|[>|<]|---)/;
/** `**Status:** …` style metadata blocks, which read badly as a description. */
const METADATA_START = /^[A-Z][A-Za-z ]{0,20}:\s/;

/** Strip inline Markdown so a paragraph reads as plain text. */
export function stripInlineMarkdown(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/(\*\*|__|\*|_)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Split plain text into sentences on `.`/`!`/`?` followed by whitespace.
 *
 * Scans boundary-to-boundary rather than matching sentence shapes, so text
 * that contains a mid-word period (`.warren/triggers.yaml`) is carried into
 * the surrounding sentence instead of being silently dropped.
 */
export function splitSentences(text: string): string[] {
	const boundary = /[.!?](?=\s|$)/g;
	const sentences: string[] = [];
	let start = 0;
	let match = boundary.exec(text);
	while (match !== null) {
		sentences.push(text.slice(start, match.index + 1).trim());
		start = match.index + 1;
		match = boundary.exec(text);
	}
	const tail = text.slice(start).trim();
	if (tail !== "") sentences.push(tail);
	return sentences;
}

/**
 * The first paragraph of ordinary prose, re-joined into one line.
 *
 * Only the paragraph's OPENING line has to look like prose; upstream docs are
 * hard-wrapped, so a continuation line may legitimately start with a bracket
 * or a link. Continuation stops at a blank line or at a line that opens a
 * different block (heading, list, quote, table, raw HTML).
 */
function proseParagraphStart(lines: readonly string[]): number {
	let inFence = false;
	for (const [index, line] of lines.entries()) {
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		const trimmed = line.trim();
		if (!inFence && PROSE_START.test(trimmed) && !BLOCK_BREAK.test(trimmed)) return index;
	}
	return -1;
}

function firstProseParagraph(markdown: string): string | undefined {
	const lines = markdown.split("\n");
	const start = proseParagraphStart(lines);
	if (start === -1) return undefined;
	const collected: string[] = [];
	for (const line of lines.slice(start)) {
		const trimmed = line.trim();
		if (trimmed === "" || FENCE.test(line)) break;
		if (collected.length > 0 && BLOCK_BREAK.test(trimmed)) break;
		collected.push(trimmed);
	}
	return collected.length === 0 ? undefined : collected.join(" ");
}

/**
 * Derive a `description` for the page from the document's opening paragraph.
 *
 * Deliberately conservative: it accumulates whole sentences until the text
 * reaches {@link DESCRIPTION_MIN} characters and gives up if that overshoots
 * {@link DESCRIPTION_MAX} or if the paragraph is a metadata block. A page
 * with no clean opening paragraph simply gets no description — a wrong one
 * is worse than none, and nothing on this site may restate upstream by hand.
 */
export function deriveDescription(markdown: string): string | undefined {
	const paragraph = firstProseParagraph(markdown);
	if (paragraph === undefined) return undefined;
	const plain = stripInlineMarkdown(paragraph);
	if (METADATA_START.test(plain)) return undefined;
	let out = "";
	for (const sentence of splitSentences(plain)) {
		const next = out === "" ? sentence : `${out} ${sentence}`;
		if (next.length > DESCRIPTION_MAX) break;
		out = next;
		if (out.length >= DESCRIPTION_MIN) break;
	}
	return out.length < DESCRIPTION_MIN ? undefined : out;
}
