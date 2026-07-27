/**
 * File-list expansion for the prose guard (`check-prose.ts`).
 *
 * Split out of the guard itself to keep each file inside the per-file line
 * budget (`budgets/file-size-budgets.json`), the same reason `prose-rules.ts`
 * exists.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Does this `files` entry use glob syntax, or name one literal path? */
function isGlob(pattern: string): boolean {
	return /[*?[\]{}]/.test(pattern);
}

/**
 * Expand one `files` entry to the repo-relative paths that exist today.
 *
 * A glob entry expands through `Bun.Glob`. A literal entry survives only when
 * the file is on disk. Both forms return an empty list when nothing matches.
 * That is deliberate: this repo tracks prose directories such as `content/`
 * that hold no markdown until an author adds some, and a listed-but-absent
 * path is a file nobody has written yet, not a gate failure. The ratchet still
 * binds every file that DOES exist.
 */
function matchPattern(pattern: string, root: string): string[] {
	if (!isGlob(pattern)) {
		return existsSync(resolve(root, pattern)) ? [pattern] : [];
	}
	return [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })]
		.map((p) => p.replaceAll("\\", "/"))
		.sort();
}

/** Expand a whole `files` list, de-duplicated, in listed order. */
export function expandPatterns(patterns: readonly string[], root: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const pattern of patterns) {
		for (const match of matchPattern(pattern, root)) {
			if (seen.has(match)) continue;
			seen.add(match);
			out.push(match);
		}
	}
	return out;
}
