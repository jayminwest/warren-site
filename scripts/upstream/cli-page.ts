/**
 * Renderer for the generated CLI reference page.
 *
 * Takes the parsed commands from `./cli.ts` and emits Markdown: one section
 * per subcommand, each with a usage line, an argument table, and an option
 * table. Pure — strings in, string out.
 */

import type { CliCommand, CliOption } from "./cli.ts";

/** Escape a value for a Markdown table cell. `|` would end the column. */
export function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|");
}

/** `warren plan run <plan-id> [options]` — the copy-pasteable invocation. */
export function usageLine(command: CliCommand): string {
	const parts = ["warren", command.path];
	for (const argument of command.args) parts.push(argument.name);
	if (command.isGroup) parts.push("<subcommand>");
	if (command.options.length > 0) parts.push("[options]");
	return parts.join(" ");
}

/** The `Default` column: an explicit default, `required`, or an em dash. */
function defaultCell(option: CliOption): string {
	if (option.defaultValue !== undefined) return `\`${escapeCell(option.defaultValue)}\``;
	return option.required ? "**required**" : "—";
}

function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.join(" | ")} |`),
	];
}

function renderCommand(command: CliCommand, children: readonly CliCommand[]): string[] {
	const lines = [`## \`warren ${command.path}\``, ""];
	if (command.description !== "") lines.push(command.description, "");
	lines.push("```bash", usageLine(command), "```", "");
	if (children.length > 0) {
		lines.push("Subcommands:", "");
		for (const child of children) lines.push(`- [\`warren ${child.path}\`](#${anchor(child)})`);
		lines.push("");
	}
	if (command.args.length > 0) {
		lines.push("### Arguments", "");
		const rows = command.args.map((a) => [`\`${escapeCell(a.name)}\``, escapeCell(a.description)]);
		lines.push(...renderTable(["Argument", "Description"], rows), "");
	}
	if (command.options.length > 0) {
		lines.push("### Options", "");
		const rows = command.options.map((option) => [
			`\`${escapeCell(option.flags)}\``,
			escapeCell(option.description),
			defaultCell(option),
		]);
		lines.push(...renderTable(["Option", "Description", "Default"], rows), "");
	}
	return lines;
}

/** GitHub-style slug of a command's `## \`warren <path>\`` heading. */
export function anchor(command: CliCommand): string {
	return `warren-${command.path.replace(/\s+/g, "-")}`;
}

export type CliPageInput = {
	readonly commands: readonly CliCommand[];
	readonly programDescription?: string | undefined;
	/** Blob URL of `src/cli/main.ts` at the pinned ref. */
	readonly sourceUrl: string;
};

/**
 * Render the whole reference. Commands keep their source order, which puts
 * each subcommand group immediately before its children.
 */
export function renderCliReference(input: CliPageInput): string {
	const lines: string[] = [];
	if (input.programDescription !== undefined) lines.push(input.programDescription, "");
	lines.push(
		`Every command below is extracted from [\`src/cli/main.ts\`](${input.sourceUrl}) at the`,
		"pinned upstream ref. Run `warren --help` for the same list from the binary you have",
		"installed.",
		"",
	);
	for (const command of input.commands) {
		const children = input.commands.filter(
			(other) => other.path.startsWith(`${command.path} `) && other.path !== command.path,
		);
		lines.push(...renderCommand(command, children));
	}
	return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}
