/**
 * Static extractor for warren's commander CLI.
 *
 * Reads `src/cli/main.ts` from the upstream checkout as TEXT and parses the
 * `.command(…).description(…).argument(…).option(…)` chains inside
 * `buildProgram()`. It never imports the module.
 *
 * Why static, not a runtime import: this is the precedent set by warren's own
 * `scripts/generate-docs.ts`, which parses `ROUTE_TABLE` with a regex
 * "because we don't have to actually load the handlers module (which has
 * heavy boot-time imports)". `src/cli/main.ts` is worse — importing it pulls
 * the client, the drizzle database layer, `bun:sqlite`, the projects config,
 * the agent registry, and the whole runtime tree, and would need warren's
 * `node_modules` installed inside `.upstream/`. The sync script installs
 * nothing in the checkout, so a static parse is the only honest option.
 *
 * The parser is deliberately loud: `parseCommands` returning zero commands is
 * treated as a broken parser by the caller, not as a CLI with no commands.
 */

export type CliArgument = {
	/** The literal commander token, brackets included: `<name>`, `[path]`. */
	readonly name: string;
	readonly description: string;
};

export type CliOption = {
	/** The literal flag string: `-p, --prompt <text>`. */
	readonly flags: string;
	readonly description: string;
	readonly defaultValue?: string | undefined;
	/** True for `.requiredOption(…)`. */
	readonly required: boolean;
};

export type CliCommand = {
	/** Space-joined command path below `warren`, e.g. `plan run`. */
	readonly path: string;
	readonly description: string;
	/** True when other commands nest under this one (`config`, `db`, `plan`). */
	readonly isGroup: boolean;
	readonly args: readonly CliArgument[];
	readonly options: readonly CliOption[];
};

/**
 * A `.command("name")` call site, optionally captured into a variable that
 * later becomes the receiver for nested commands
 * (`const planGroup = program.command("plan")`).
 */
const COMMAND_SITE =
	/(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?([A-Za-z_$][\w$]*)\s*\.command\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

/** Builder calls whose string arguments carry the reference content. */
const BUILDER_CALL = /\.(description|argument|option|requiredOption)\s*\(/g;

/** Program-level `.name("warren").description("…")`, used for the page intro. */
const PROGRAM_HEADER =
	/\.name\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\.description\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;

function unescapeLiteral(value: string): string {
	return value.replace(/\\(.)/g, (_match, char: string) => {
		if (char === "n") return "\n";
		if (char === "t") return "\t";
		return char;
	});
}

/**
 * Return the text between the parentheses that open at `openIndex`, skipping
 * over string literals so that a `(` inside a description does not unbalance
 * the scan. Commander descriptions really do contain parentheses — see
 * `"output mode: ndjson (default) or pretty"`.
 */
export function readBalanced(source: string, openIndex: number): { inner: string; end: number } {
	let depth = 0;
	for (let i = openIndex; i < source.length; i++) {
		const char = source[i];
		if (char === '"' || char === "'" || char === "`") {
			i = skipQuoted(source, i);
		} else if (char === "(") {
			depth++;
		} else if (char === ")" && --depth === 0) {
			return { inner: source.slice(openIndex + 1, i), end: i + 1 };
		}
	}
	throw new Error("sync:upstream: unbalanced parentheses while parsing the CLI source");
}

/** Consume a quoted literal starting at `start`; return the index of its closing quote. */
function skipQuoted(text: string, start: number): number {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === quote) return i;
	}
	return text.length;
}

/**
 * Collect the top-level double-quoted arguments of a builder call, in order.
 * Nested literals (inside an object or a call) are skipped, so an inline
 * default such as `{ label: "x" }` cannot be mistaken for a description.
 */
export function topLevelStringArgs(inner: string): string[] {
	const values: string[] = [];
	let depth = 0;
	for (let i = 0; i < inner.length; i++) {
		const char = inner[i];
		if (char === "(" || char === "[" || char === "{") depth++;
		else if (char === ")" || char === "]" || char === "}") depth--;
		else if (char === "'" || char === "`") i = skipQuoted(inner, i);
		else if (char === '"') {
			const end = skipQuoted(inner, i);
			if (depth === 0) values.push(unescapeLiteral(inner.slice(i + 1, end)));
			i = end;
		}
	}
	return values;
}

type ChainParts = { description: string; args: CliArgument[]; options: CliOption[] };

function applyBuilderCall(kind: string, values: readonly string[], parts: ChainParts): void {
	const [first, second, third] = values;
	if (kind === "description" && first !== undefined) parts.description = first;
	else if (kind === "argument" && first !== undefined) {
		parts.args.push({ name: first, description: second ?? "" });
	} else if ((kind === "option" || kind === "requiredOption") && first !== undefined) {
		parts.options.push({
			flags: first,
			description: second ?? "",
			defaultValue: third,
			required: kind === "requiredOption",
		});
	}
}

/** Parse one `.command(...)` chain body into its description, args, and options. */
export function parseChain(body: string): ChainParts {
	const parts: ChainParts = { description: "", args: [], options: [] };
	BUILDER_CALL.lastIndex = 0;
	let match = BUILDER_CALL.exec(body);
	while (match !== null) {
		const kind = match[1] ?? "";
		const { inner, end } = readBalanced(body, match.index + match[0].length - 1);
		applyBuilderCall(kind, topLevelStringArgs(inner), parts);
		BUILDER_CALL.lastIndex = end;
		match = BUILDER_CALL.exec(body);
	}
	return parts;
}

/**
 * The chain for a command ends at its `.action(` callback — everything after
 * that is handler code that may itself contain the strings we look for.
 * Commands with no action (the subcommand groups) end at the next
 * `.command(` call site instead.
 */
function chainBodyEnd(source: string, start: number, nextSite: number): number {
	const actionAt = source.indexOf(".action(", start);
	return actionAt !== -1 && actionAt < nextSite ? actionAt : nextSite;
}

/** Extract every subcommand, in source order, with groups before their children. */
export function parseCommands(source: string): CliCommand[] {
	const sites = [...source.matchAll(COMMAND_SITE)];
	const pathByReceiver = new Map<string, string>([["program", ""]]);
	const commands: CliCommand[] = [];
	const parents = new Set<string>();
	for (const [index, site] of sites.entries()) {
		const receiver = site[2] ?? "";
		const parent = pathByReceiver.get(receiver);
		if (parent === undefined || site.index === undefined) continue;
		const path = [parent, unescapeLiteral(site[3] ?? "")].filter((part) => part !== "").join(" ");
		const alias = site[1];
		if (alias !== undefined) pathByReceiver.set(alias, path);
		if (parent !== "") parents.add(parent);
		const start = site.index + site[0].length;
		const nextSite = sites[index + 1]?.index ?? source.length;
		const parts = parseChain(source.slice(start, chainBodyEnd(source, start, nextSite)));
		commands.push({ path, isGroup: false, ...parts });
	}
	return commands.map((command) => ({ ...command, isGroup: parents.has(command.path) }));
}

/** The program's own `.description(…)`, used as the reference page intro. */
export function parseProgramDescription(source: string): string | undefined {
	const match = source.match(PROGRAM_HEADER);
	return match?.[2] === undefined ? undefined : unescapeLiteral(match[2]);
}
