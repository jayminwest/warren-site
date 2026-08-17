/**
 * Mechanically extractable facts about the pinned upstream release.
 *
 * Everything here is parsed from a machine-readable artifact — a JSON field,
 * a YAML key set, the CLI's own command chains. Nothing is read out of prose and nothing is inferred, because the
 * landing page cites this file as ground truth: a number it prints has to be
 * a number the product actually reports. If a claim cannot be extracted this
 * way, it does not belong in `facts.generated.json`.
 *
 * Pure module: strings in, string out. No filesystem, no network.
 */

import { parse as parseYaml } from "yaml";
import type { CliCommand } from "./cli.ts";

function fail(what: string): never {
	throw new Error(`sync:upstream: could not extract ${what} from the upstream checkout`);
}

/** A non-empty string field from warren's root `package.json`. */
function packageField(packageJson: string, field: string): string {
	const parsed: unknown = JSON.parse(packageJson);
	if (typeof parsed !== "object" || parsed === null) fail("the package.json object");
	const value = (parsed as Record<string, unknown>)[field];
	return typeof value === "string" && value !== "" ? value : fail(`package.json ${field}`);
}

/** `version` from warren's root `package.json`. */
export function extractVersion(packageJson: string): string {
	return packageField(packageJson, "version");
}

/** `license` from warren's root `package.json` — the SPDX identifier, not prose. */
export function extractLicense(packageJson: string): string {
	return packageField(packageJson, "license");
}

/**
 * Every environment variable warren's `.env.example` documents, active or
 * commented out. The commented entries are the optional knobs, so they
 * count: the file's key set is the operator-facing configuration surface.
 */
export function parseEnvExampleKeys(envExample: string): string[] {
	const keys = new Set<string>();
	for (const line of envExample.split("\n")) {
		const key = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1];
		if (key !== undefined) keys.add(key);
	}
	return keys.size > 0 ? [...keys].sort() : fail("any keys from .env.example");
}

/**
 * The `env[].name` entries of warren's Kubernetes deployment manifest.
 * This is where k8s-topology variables such as `WARREN_RUNTIME` live —
 * `.env.example` documents the docker-compose topology and omits them.
 */
export function parseK8sEnvNames(deploymentYaml: string): string[] {
	const names = new Set<string>();
	for (const match of deploymentYaml.matchAll(/^\s*-\s*name:\s*([A-Z][A-Z0-9_]*)\s*$/gm)) {
		const name = match[1];
		if (name !== undefined) names.add(name);
	}
	return names.size > 0 ? [...names].sort() : fail("any env names from the k8s deployment");
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

export type FactsInput = {
	readonly ref: string;
	readonly packageJson: string;
	readonly openapiYaml: string;
	readonly envExample: string;
	readonly k8sDeployment: string;
	readonly commands: readonly CliCommand[];
};

export type UpstreamFacts = {
	readonly _generated: string;
	readonly ref: string;
	readonly version: string;
	readonly license: string;
	readonly httpPathCount: number;
	readonly cliCommandCount: number;
	readonly cliCommands: readonly string[];
	/** Union of `.env.example` keys and the k8s deployment's env names. */
	readonly envVars: readonly string[];
};

/** Build the fact set. Deterministic: no timestamps, no host-dependent values. */
export function buildFacts(input: FactsInput): UpstreamFacts {
	const envVars = [
		...new Set([
			...parseEnvExampleKeys(input.envExample),
			...parseK8sEnvNames(input.k8sDeployment),
		]),
	].sort();
	return {
		_generated:
			"Written by `bun run sync:upstream` from jayminwest/warren at the pinned ref. " +
			"Do not edit — every value is extracted mechanically from an upstream artifact.",
		ref: input.ref,
		version: extractVersion(input.packageJson),
		license: extractLicense(input.packageJson),
		httpPathCount: countOpenApiPaths(input.openapiYaml),
		cliCommandCount: input.commands.length,
		cliCommands: input.commands.map((command) => command.path),
		envVars,
	};
}

/** Serialise the fact set the way the repository commits it (tabs, trailing newline). */
export function renderFacts(facts: UpstreamFacts): string {
	return `${JSON.stringify(facts, null, "\t")}\n`;
}
