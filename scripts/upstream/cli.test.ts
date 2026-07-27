/**
 * Tests for the static commander extractor and the reference-page renderer.
 *
 * The fixture below mirrors the shapes `src/cli/main.ts` actually uses: a
 * program header, a leaf command with arguments and options, a subcommand
 * group captured into a variable, a multi-line `.option(...)` call, and an
 * `.action(...)` body containing a decoy `.description(...)`.
 */

import { describe, expect, test } from "bun:test";
import {
	type CliCommand,
	parseChain,
	parseCommands,
	parseProgramDescription,
	readBalanced,
	topLevelStringArgs,
} from "./cli.ts";
import { anchor, escapeCell, renderCliReference, usageLine } from "./cli-page.ts";

const CLI_FIXTURE = `
export function buildProgram(context: CliContext): Command {
	const program = new Command();
	program
		.name("warren")
		.description("Control plane and UI for cloud-based custom agents")
		.version(VERSION);

	program
		.command("run")
		.description("spawn a one-shot run")
		.argument("<agent>", "registered agent name")
		.requiredOption("-p, --prompt <text>", "prompt text the agent receives")
		.option("--trigger <label>", "run trigger label", "cli")
		.action(async (agent: string) => {
			// A decoy: .description("never parsed") lives in the action body.
			process.exit(await go(agent));
		});

	const planGroup = program.command("plan").description("dispatch cloud plan-runs");
	planGroup
		.command("list")
		.description("list plan-runs")
		.option(
			"--state <state>",
			"only plan-runs in this state (queued|running|failed)",
		)
		.action(async () => {
			process.exit(0);
		});
	return program;
}
`;

describe("readBalanced", () => {
	test("ignores parentheses inside string literals", () => {
		const source = '.option("a (b) c")';
		expect(readBalanced(source, source.indexOf("(")).inner).toBe('"a (b) c"');
	});

	test("throws on an unbalanced call", () => {
		expect(() => readBalanced('.option("x"', 7)).toThrow(/unbalanced/);
	});
});

describe("topLevelStringArgs", () => {
	test("collects only top-level double-quoted arguments", () => {
		expect(topLevelStringArgs('"a", { label: "nested" }, \'skip\', "b"')).toEqual(["a", "b"]);
	});

	test("unescapes embedded quotes and newlines", () => {
		expect(topLevelStringArgs('"say \\"hi\\"\\nnow"')).toEqual(['say "hi"\nnow']);
	});
});

describe("parseChain", () => {
	test("collects description, arguments, and options in order", () => {
		const parts = parseChain(
			'.description("d").argument("<a>", "arg doc").option("--x <v>", "opt doc", "def")',
		);
		expect(parts.description).toBe("d");
		expect(parts.args).toEqual([{ name: "<a>", description: "arg doc" }]);
		expect(parts.options[0]?.defaultValue).toBe("def");
	});
});

describe("parseCommands", () => {
	const commands = parseCommands(CLI_FIXTURE);
	const byPath = new Map(commands.map((command) => [command.path, command]));

	test("finds every command, including nested ones, in source order", () => {
		expect(commands.map((command) => command.path)).toEqual(["run", "plan", "plan list"]);
	});

	test("reads the description, arguments, and options of a leaf command", () => {
		const run = byPath.get("run");
		expect(run?.description).toBe("spawn a one-shot run");
		expect(run?.args).toEqual([{ name: "<agent>", description: "registered agent name" }]);
		expect(run?.options).toEqual([
			{
				flags: "-p, --prompt <text>",
				description: "prompt text the agent receives",
				defaultValue: undefined,
				required: true,
			},
			{
				flags: "--trigger <label>",
				description: "run trigger label",
				defaultValue: "cli",
				required: false,
			},
		]);
	});

	test("stops each chain at .action so handler bodies are never parsed", () => {
		expect(byPath.get("run")?.description).not.toBe("never parsed");
	});

	test("marks a receiver that owns children as a group", () => {
		expect(byPath.get("plan")?.isGroup).toBe(true);
		expect(byPath.get("plan list")?.isGroup).toBe(false);
	});

	test("parses a multi-line option call", () => {
		expect(byPath.get("plan list")?.options[0]?.description).toBe(
			"only plan-runs in this state (queued|running|failed)",
		);
	});

	test("returns an empty list when nothing matches, so the caller can fail loudly", () => {
		expect(parseCommands("export const x = 1;")).toEqual([]);
	});
});

describe("parseProgramDescription", () => {
	test("reads the program-level description", () => {
		expect(parseProgramDescription(CLI_FIXTURE)).toBe(
			"Control plane and UI for cloud-based custom agents",
		);
	});

	test("returns undefined when the header is absent", () => {
		expect(parseProgramDescription("const x = 1;")).toBeUndefined();
	});
});

const LEAF: CliCommand = {
	path: "plan list",
	description: "list plan-runs",
	isGroup: false,
	args: [{ name: "<id>", description: "plan id" }],
	options: [
		{ flags: "--state <s>", description: "a|b", defaultValue: undefined, required: false },
		{ flags: "--project <id>", description: "project", defaultValue: "p", required: true },
	],
};

describe("cli-page", () => {
	test("escapes pipes so a table cell cannot end early", () => {
		expect(escapeCell("a|b")).toBe("a\\|b");
	});

	test("builds a usage line from arguments and options", () => {
		expect(usageLine(LEAF)).toBe("warren plan list <id> [options]");
	});

	test("marks a group's usage line with a subcommand placeholder", () => {
		expect(usageLine({ ...LEAF, path: "plan", args: [], options: [], isGroup: true })).toBe(
			"warren plan <subcommand>",
		);
	});

	test("derives the heading anchor from the command path", () => {
		expect(anchor(LEAF)).toBe("warren-plan-list");
	});

	test("renders a section with usage, argument and option tables", () => {
		const page = renderCliReference({ commands: [LEAF], sourceUrl: "https://src" });
		expect(page).toContain("## `warren plan list`");
		expect(page).toContain("```bash\nwarren plan list <id> [options]\n```");
		expect(page).toContain("| `<id>` | plan id |");
		expect(page).toContain("| `--state <s>` | a\\|b | — |");
		expect(page).toContain("| `--project <id>` | project | `p` |");
	});

	test("links a group to its children", () => {
		const group = { ...LEAF, path: "plan", args: [], options: [], isGroup: true };
		const page = renderCliReference({ commands: [group, LEAF], sourceUrl: "https://src" });
		expect(page).toContain("- [`warren plan list`](#warren-plan-list)");
	});
});
