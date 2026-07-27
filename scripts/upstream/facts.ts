/**
 * Mechanically extractable facts about the pinned upstream release.
 *
 * Everything here is parsed from a machine-readable artifact — a JSON field,
 * a YAML key set, a pinned version in a `Dockerfile`, the CLI's own command
 * chains. Nothing is read out of prose and nothing is inferred, because the
 * landing page cites this file as ground truth: a number it prints has to be
 * a number the product actually reports. If a claim cannot be extracted this
 * way, it does not belong in `facts.generated.json`.
 *
 * Pure module: strings in, string out. No filesystem, no network.
 */

import { parse as parseYaml } from "yaml";
import type { CliCommand } from "./cli.ts";

/** `@os-eco/burrow-cli@0.3.15` in the Dockerfile's global install. */
const BURROW_PIN = /@os-eco\/burrow-cli@(\d[^\s\\"']*)/;

function fail(what: string): never {
	throw new Error(`sync:upstream: could not extract ${what} from the upstream checkout`);
}

/** `version` from warren's root `package.json`. */
export function extractVersion(packageJson: string): string {
	const parsed: unknown = JSON.parse(packageJson);
	if (typeof parsed !== "object" || parsed === null) fail("the package.json object");
	const version = (parsed as Record<string, unknown>).version;
	return typeof version === "string" && version !== "" ? version : fail("package.json version");
}

/**
 * Number of distinct paths in warren's OpenAPI 3.1 schema.
 *
 * This is the path count, not the operation count — one path may carry
 * several methods. `docs/openapi.yaml` is itself generated upstream from
 * `ROUTE_TABLE`, so the number tracks the real router.
 */
export function countOpenApiPaths(openapiYaml: string): number {
	const document: unknown = parseYaml(openapiYaml);
	if (typeof document !== "object" || document === null) fail("the OpenAPI document");
	const paths = (document as Record<string, unknown>).paths;
	if (typeof paths !== "object" || paths === null) fail("the OpenAPI `paths` map");
	const count = Object.keys(paths).length;
	return count > 0 ? count : fail("a non-empty OpenAPI `paths` map");
}

/** The `@os-eco/burrow-cli` version the container image installs. */
export function extractBurrowPin(dockerfile: string): string {
	return dockerfile.match(BURROW_PIN)?.[1] ?? fail("the @os-eco/burrow-cli pin");
}

export type FactsInput = {
	readonly ref: string;
	readonly packageJson: string;
	readonly openapiYaml: string;
	readonly dockerfile: string;
	readonly commands: readonly CliCommand[];
};

export type UpstreamFacts = {
	readonly _generated: string;
	readonly ref: string;
	readonly version: string;
	readonly httpPathCount: number;
	readonly burrowCliPin: string;
	readonly cliCommandCount: number;
	readonly cliCommands: readonly string[];
};

/** Build the fact set. Deterministic: no timestamps, no host-dependent values. */
export function buildFacts(input: FactsInput): UpstreamFacts {
	return {
		_generated:
			"Written by `bun run sync:upstream` from jayminwest/warren at the pinned ref. " +
			"Do not edit — every value is extracted mechanically from an upstream artifact.",
		ref: input.ref,
		version: extractVersion(input.packageJson),
		httpPathCount: countOpenApiPaths(input.openapiYaml),
		burrowCliPin: extractBurrowPin(input.dockerfile),
		cliCommandCount: input.commands.length,
		cliCommands: input.commands.map((command) => command.path),
	};
}

/** Serialise the fact set the way the repository commits it (tabs, trailing newline). */
export function renderFacts(facts: UpstreamFacts): string {
	return `${JSON.stringify(facts, null, "\t")}\n`;
}
