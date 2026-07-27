/**
 * YAML frontmatter reader for the prose guard (`scripts/check-prose.ts`).
 *
 * Frontmatter is where a marketing page keeps the copy a reader sees FIRST —
 * `headline`, `eyebrow`, `description`, CTA `label`. A guard that reads only
 * the body would exempt exactly the sentences it exists to police, so every
 * string scalar in the block is pulled out here and linted like any other
 * line.
 *
 * This module knows YAML and nothing else. It returns raw scalar text with
 * source line numbers; reducing that text to prose (stripping inline
 * markdown) belongs to the markdown side, in `check-prose.ts`.
 *
 * The parser is deliberately line-based rather than a real YAML load. The
 * guard needs the SOURCE LINE of every string it reports, which a parsed
 * object no longer carries, and frontmatter on this site is a flat map of
 * scalars and one level of nesting.
 */

/** YAML plain scalars that are not text: booleans, null, and their aliases. */
const YAML_NOT_TEXT = /^(?:true|false|null|~|yes|no|on|off)$/i;
/** A YAML number, including the `_`-separated and exponent forms. */
const YAML_NUMBER = /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+)$/;
/** A block-scalar header (`|`, `>-`, `|2`): the text is on the lines below. */
const YAML_BLOCK_HEADER = /^[|>][-+]?\d*$/;
/** `key:` at the start of a frontmatter entry. */
const YAML_KEY = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;
/** The `---` fence that opens and closes a frontmatter block. */
const FENCE = "---";

export type FrontmatterScalar = { readonly line: number; readonly scalar: string };

/**
 * The text of a YAML scalar, or `undefined` when the value is not text.
 *
 * Quoted forms are unquoted. Plain forms are rejected when they are a number,
 * a boolean, a flow collection, an anchor or alias, or a block-scalar header —
 * a block scalar's text arrives on the following lines and is read there as a
 * plain scalar.
 */
export function yamlScalarText(value: string): string | undefined {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	if (YAML_NOT_TEXT.test(value) || YAML_NUMBER.test(value)) return undefined;
	if (YAML_BLOCK_HEADER.test(value)) return undefined;
	if (/^[[{&*]/.test(value)) return undefined;
	return value;
}

/**
 * The text carried by one frontmatter line: a mapping value, a sequence item,
 * or a line of block-scalar body. A key is never prose, so `headline: "x"`
 * yields `x` and `primaryCta:` yields nothing.
 */
export function frontmatterScalar(rawLine: string): string | undefined {
	let rest = rawLine.trim();
	if (rest === "" || rest.startsWith("#") || rest === "-") return undefined;
	if (rest.startsWith("- ")) rest = rest.slice(2).trim();
	const keyed = YAML_KEY.exec(rest);
	if (keyed !== null) rest = (keyed[2] ?? "").trim();
	if (rest === "") return undefined;
	return yamlScalarText(rest);
}

/**
 * Every string scalar in the document's frontmatter, with 1-based source line
 * numbers. Returns nothing when the document does not open with `---`.
 */
export function frontmatterScalars(lines: readonly string[]): FrontmatterScalar[] {
	if ((lines[0] ?? "").trim() !== FENCE) return [];
	const out: FrontmatterScalar[] = [];
	for (let i = 1; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		if (raw.trim() === FENCE) break;
		const scalar = frontmatterScalar(raw);
		if (scalar !== undefined) out.push({ line: i + 1, scalar });
	}
	return out;
}
