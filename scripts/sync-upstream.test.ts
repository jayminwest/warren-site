/**
 * Tests for the fact extractor and the end-to-end generation plan.
 *
 * `planOutputs` is the whole of the sync's decision-making, so exercising it
 * with in-memory sources covers the pipeline without a checkout or a network.
 */

import { describe, expect, test } from "bun:test";
import { BLOB_BASE, UPSTREAM, UPSTREAM_DOCS } from "../src/config/upstream.ts";
import { diffSummary } from "./sync-upstream.ts";
import type { CliCommand } from "./upstream/cli.ts";
import {
	buildFacts,
	countOpenApiPaths,
	extractLicense,
	extractVersion,
	parseEnvExampleKeys,
	parseK8sEnvNames,
	renderFacts,
} from "./upstream/facts.ts";
import { yamlString } from "./upstream/markdown.ts";
import {
	allSourcePaths,
	CLI_OUT_PATH,
	EXTRA_SOURCES,
	expectedOutputPaths,
	FACTS_OUT_PATH,
	generatedBanner,
	missingSourcesReport,
	planOutputs,
	THEME_OUT_PATH,
	type UpstreamSources,
} from "./upstream/plan.ts";

/** A CLI source small enough to read at a glance; the parser has its own suite. */
const CLI_FIXTURE = `
	program
		.command("plan")
		.description("dispatch cloud plan-runs")
		.option("--output <mode>", "output mode", "ndjson")
		.action(async () => {
			process.exit(0);
		});
`;

/** Stand-in for a parsed command, used by the facts suite. */
const LEAF: CliCommand = {
	path: "plan list",
	description: "list plan-runs",
	isGroup: false,
	args: [],
	options: [],
};

const PACKAGE_JSON = '{ "name": "warren", "version": "1.2.3", "license": "MIT" }';
const OPENAPI = "openapi: 3.1.0\npaths:\n  /runs: {}\n  /runs/{id}: {}\n";

const ENV_EXAMPLE = [
	"# Bearer token guarding every route.",
	"WARREN_API_TOKEN=",
	"# WARREN_DB_URL=postgres://…",
	"#WARREN_LOG_LEVEL=info",
	"ANTHROPIC_API_KEY=",
	"",
].join("\n");

const K8S_DEPLOYMENT = [
	"spec:",
	"  containers:",
	"    - name: warren",
	"      env:",
	"        - name: WARREN_RUNTIME",
	'          value: "k8s"',
	"        - name: WARREN_API_TOKEN",
	"",
].join("\n");

/** The two blocks `scripts/upstream/tokens.ts` lifts; that module has its own suite. */
const THEME_CSS = [
	'@import "tailwindcss";',
	"",
	"@theme {",
	"\t--color-bg: oklch(99% 0.003 264);",
	"}",
	"",
	':root[data-theme="dark"] {',
	"\t--color-bg: oklch(14% 0.008 264);",
	"}",
	"",
].join("\n");

describe("facts", () => {
	test("reads the package version", () => {
		expect(extractVersion(PACKAGE_JSON)).toBe("1.2.3");
	});

	test("counts OpenAPI paths, not operations", () => {
		expect(countOpenApiPaths(OPENAPI)).toBe(2);
	});

	test("reads the SPDX license identifier", () => {
		expect(extractLicense(PACKAGE_JSON)).toBe("MIT");
	});

	test("collects env keys from .env.example, commented or not", () => {
		expect(parseEnvExampleKeys(ENV_EXAMPLE)).toEqual([
			"ANTHROPIC_API_KEY",
			"WARREN_API_TOKEN",
			"WARREN_DB_URL",
			"WARREN_LOG_LEVEL",
		]);
	});

	test("collects env names from the k8s deployment manifest", () => {
		expect(parseK8sEnvNames(K8S_DEPLOYMENT)).toEqual(["WARREN_API_TOKEN", "WARREN_RUNTIME"]);
	});

	test.each([
		["a missing version", () => extractVersion("{}")],
		["a missing license", () => extractLicense('{ "version": "1.0.0" }')],
		["a schema with no paths", () => countOpenApiPaths("openapi: 3.1.0\n")],
		["an empty paths map", () => countOpenApiPaths("paths: {}\n")],
		["an .env.example with no keys", () => parseEnvExampleKeys("# only comments\n")],
		["a deployment with no env list", () => parseK8sEnvNames("spec: {}\n")],
	])("fails loudly on %s", (_label, run) => {
		expect(run).toThrow(/could not extract/);
	});

	test("builds and serialises a deterministic fact set", () => {
		const facts = buildFacts({
			ref: "v9.9.9",
			packageJson: PACKAGE_JSON,
			openapiYaml: OPENAPI,
			envExample: ENV_EXAMPLE,
			k8sDeployment: K8S_DEPLOYMENT,
			commands: [LEAF],
		});
		expect(facts).toMatchObject({
			ref: "v9.9.9",
			version: "1.2.3",
			license: "MIT",
			httpPathCount: 2,
			cliCommandCount: 1,
			cliCommands: ["plan list"],
			// The union is sorted and de-duplicated across both sources.
			envVars: [
				"ANTHROPIC_API_KEY",
				"WARREN_API_TOKEN",
				"WARREN_DB_URL",
				"WARREN_LOG_LEVEL",
				"WARREN_RUNTIME",
			],
		});
		const rendered = renderFacts(facts);
		expect(rendered.endsWith("\n")).toBe(true);
		expect(rendered).toContain('\t"version": "1.2.3"');
		expect(renderFacts(facts)).toBe(rendered);
	});
});

function sourcesFor(docs: ReadonlyMap<string, string>): UpstreamSources {
	return {
		docs,
		cliMain: CLI_FIXTURE,
		packageJson: PACKAGE_JSON,
		openapi: OPENAPI,
		envExample: ENV_EXAMPLE,
		k8sDeployment: K8S_DEPLOYMENT,
		themeCss: THEME_CSS,
	};
}

/** A body for every manifest entry, so `planOutputs` has a complete input. */
function fullDocs(): Map<string, string> {
	return new Map(
		UPSTREAM_DOCS.map((doc) => [
			doc.source,
			`# Upstream title\n\nSome prose that is long enough to become a page description here.\n`,
		]),
	);
}

describe("planOutputs", () => {
	const files = planOutputs(sourcesFor(fullDocs()));
	const byPath = new Map(files.map((file) => [file.path, file.content]));

	test("writes one page per manifest entry plus the CLI reference, facts, and tokens", () => {
		expect(files.map((file) => file.path)).toEqual(expectedOutputPaths());
		expect(files).toHaveLength(UPSTREAM_DOCS.length + 3);
	});

	test("gives every page a banner and an upstream editUrl", () => {
		for (const doc of UPSTREAM_DOCS) {
			const content = byPath.get(`src/content/docs/docs/${doc.slug}.md`) ?? "";
			expect(content).toContain(generatedBanner(doc.source));
			expect(content).toContain(`editUrl: "${BLOB_BASE}/${doc.source}"`);
			expect(content).toContain(`title: ${yamlString(doc.title)}`);
			expect(content).not.toContain("# Upstream title");
		}
	});

	test("renders the CLI reference and the facts file", () => {
		expect(byPath.get(CLI_OUT_PATH)).toContain("## `warren plan`");
		expect(byPath.get(FACTS_OUT_PATH)).toContain(`"ref": "${UPSTREAM.ref}"`);
	});

	test("renders the token stylesheet from warren's tokens.css at the pinned ref", () => {
		const css = byPath.get(THEME_OUT_PATH) ?? "";
		expect(css).toContain(`@ ref \`${UPSTREAM.ref}\``);
		expect(css).toContain(":root {\n\t--color-bg: oklch(99% 0.003 264);\n}");
		// The header names `@theme` in prose; only the RULE must be gone.
		expect(css).not.toContain("\n@theme {");
	});

	test("fails when warren's stylesheet no longer holds a token block", () => {
		const sources = { ...sourcesFor(fullDocs()), themeCss: "body { color: red; }\n" };
		expect(() => planOutputs(sources)).toThrow(/has been restructured/);
	});

	test("is deterministic across runs", () => {
		expect(planOutputs(sourcesFor(fullDocs()))).toEqual(files);
	});

	test("fails when a manifest entry is absent from the checkout", () => {
		const docs = fullDocs();
		docs.delete(UPSTREAM_DOCS[0]?.source ?? "");
		expect(() => planOutputs(sourcesFor(docs))).toThrow(/absent from/);
	});

	test("names EVERY missing source in one error, not just the first", () => {
		// A warren docs reshuffle breaks several entries at once; a
		// throw-on-first here would cost one sync run per renamed file.
		const docs = fullDocs();
		const dropped = UPSTREAM_DOCS.slice(0, 3).map((doc) => doc.source);
		for (const source of dropped) docs.delete(source);
		let message = "";
		try {
			planOutputs(sourcesFor(docs));
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain(`${dropped.length} source file(s)`);
		for (const source of dropped) expect(message).toContain(`- ${source}`);
	});

	test("refuses to emit an empty CLI reference", () => {
		const sources = { ...sourcesFor(fullDocs()), cliMain: "export const nothing = 1;" };
		expect(() => planOutputs(sources)).toThrow(/found no commands/);
	});
});

describe("missingSourcesReport", () => {
	test("attributes each missing path to its manifest entry", () => {
		const doc = UPSTREAM_DOCS[0]?.source ?? "";
		const report = missingSourcesReport([doc, "docs/openapi.yaml", "docs/never-existed.md"]);
		expect(report).toContain("3 source file(s)");
		expect(report).toContain(`- ${doc}  (UPSTREAM_DOCS -> `);
		expect(report).toContain("- docs/openapi.yaml  (EXTRA_SOURCES.openapi)");
		expect(report).toContain("- docs/never-existed.md  (not in the manifest)");
		expect(report).toContain("ONE pass");
	});
});

describe("allSourcePaths", () => {
	test("covers the narrative docs and every extra source", () => {
		const paths = allSourcePaths();
		for (const doc of UPSTREAM_DOCS) expect(paths).toContain(doc.source);
		for (const source of Object.values(EXTRA_SOURCES)) expect(paths).toContain(source);
		expect(paths).toHaveLength(UPSTREAM_DOCS.length + Object.keys(EXTRA_SOURCES).length);
	});
});

describe("generatedBanner", () => {
	test("names the pinned ref and the upstream source path", () => {
		expect(generatedBanner("docs/labels.md")).toContain(
			`${UPSTREAM.owner}/${UPSTREAM.repo}@${UPSTREAM.ref} (docs/labels.md)`,
		);
	});
});

describe("diffSummary", () => {
	test("reports the first differing line with both sides", () => {
		const summary = diffSummary("a\nb\n", "a\nc\n").join("\n");
		expect(summary).toContain("line 2");
		expect(summary).toContain("committed: c");
		expect(summary).toContain("expected:  b");
	});

	test("marks a missing line rather than printing undefined", () => {
		expect(diffSummary("a\nb\n", "a\n").join("\n")).toContain("committed: (no such line)");
	});

	test("explains a whitespace-only difference", () => {
		expect(diffSummary("a", "a")).toEqual(["    (files differ only in trailing whitespace)"]);
	});
});
