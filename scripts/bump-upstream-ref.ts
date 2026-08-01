#!/usr/bin/env bun
/**
 * Read or rewrite the pinned upstream ref in `src/config/upstream.ts`.
 *
 *   bun scripts/bump-upstream-ref.ts --current   # print the pinned ref
 *   bun scripts/bump-upstream-ref.ts v1.2.3      # rewrite the pin to v1.2.3
 *
 * The nightly sync workflow calls both forms. This script replaces the
 * grep + perl + `git diff --quiet` shell that used to live in
 * `.github/workflows/sync-upstream.yml`, which carried two exit-status
 * traps:
 *
 *   1. `git diff --quiet <file> && { echo "::error"; exit 1; }` — `--quiet`
 *      exits 1 when there IS a diff, so the `&&` list failed exactly when
 *      the bump had WORKED, and as the step's last command that exit
 *      status became the step's own. Every successful bump therefore
 *      reported failure, which is why the site sat at a stale ref.
 *   2. `CURRENT=$(grep ... | grep ...)` under `set -euo pipefail` — an
 *      empty match failed the assignment itself, so the friendly
 *      "pattern stopped matching" branch below it could never run.
 *
 * Both checks now live here as thrown errors with the same messages,
 * and `bumpPinnedRef` is unit-tested in `bump-upstream-ref.test.ts`.
 *
 * This script imports nothing outside the standard library on purpose:
 * the workflow runs it BEFORE `bun install`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** The file that pins the upstream ref, relative to the repo root. */
export const UPSTREAM_CONFIG_PATH = "src/config/upstream.ts";

/** The pin as it appears in the config: `ref: "v1.2.3"`. */
const REF_FIELD = /(\bref:\s*")(v\d+\.\d+\.\d+)(")/;

/** Release tags this site accepts as a pin. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** Extract the pinned ref, or throw when the UPSTREAM block was restructured. */
export function readPinnedRef(source: string): string {
	const ref = source.match(REF_FIELD)?.[2];
	if (ref === undefined) {
		throw new Error(
			`could not read the pinned ref from ${UPSTREAM_CONFIG_PATH}. ` +
				"The UPSTREAM block was restructured; update REF_FIELD in scripts/bump-upstream-ref.ts.",
		);
	}
	return ref;
}

/**
 * Return `source` with the pin rewritten to `target`. Throws when the
 * target is not a release tag, or when the rewrite would change nothing —
 * a no-op bump means the caller resolved the wrong target, and sailing on
 * would open an empty pull request.
 */
export function bumpPinnedRef(source: string, target: string): string {
	if (!RELEASE_TAG.test(target)) {
		throw new Error(`"${target}" is not a release tag (expected vMAJOR.MINOR.PATCH).`);
	}
	const current = readPinnedRef(source);
	if (current === target) {
		throw new Error(`bumping the ref to ${target} changed nothing: already pinned there.`);
	}
	return source.replace(REF_FIELD, `$1${target}$3`);
}

/** Console seam, injected by the tests so the suite stays quiet. */
export type CliIo = {
	readonly log: (line: string) => void;
	readonly error: (line: string) => void;
};

/** The whole CLI, parameterized for tests: argv + config path in, exit code out. */
export function runCli(argv: readonly string[], configPath: string, io: CliIo): number {
	const arg = argv[0];
	if (arg === undefined || argv.length > 1) {
		io.error("usage: bun scripts/bump-upstream-ref.ts <--current | vX.Y.Z>");
		return 1;
	}
	const source = readFileSync(configPath, "utf8");
	try {
		if (arg === "--current") {
			io.log(readPinnedRef(source));
			return 0;
		}
		const current = readPinnedRef(source);
		writeFileSync(configPath, bumpPinnedRef(source, arg));
		io.log(`${UPSTREAM_CONFIG_PATH}: ${current} -> ${arg}`);
		return 0;
	} catch (error) {
		io.error(`bump-upstream-ref: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (import.meta.main) {
	process.exit(
		runCli(process.argv.slice(2), resolve(import.meta.dir, "..", UPSTREAM_CONFIG_PATH), {
			log: console.log,
			error: console.error,
		}),
	);
}
