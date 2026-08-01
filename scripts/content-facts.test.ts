/**
 * Holds the hand-written landing copy in `content/*.md` to the derived
 * facts in `src/config/facts.generated.json`.
 *
 * The unit under test is the CONTENT tree, not a module: authored prose
 * is allowed to NAME upstream truths — an env var, the license — but
 * every such claim must agree with what `bun run sync:upstream`
 * extracted from warren at the pinned ref. When warren renames an env
 * var or changes its license, the next sync updates the facts file and
 * this suite points at every sentence that went stale.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import facts from "../src/config/facts.generated.json";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CONTENT_DIR = join(REPO_ROOT, "content");

/** SPDX-ish license names the copy could plausibly drop into a sentence. */
const LICENSE_NAME = /\b(MIT|Apache-[\d.]+|GPL-[\w.-]+|BSD-[\w-]+|MPL-[\d.]+)\b/g;

const ENV_VAR = /\bWARREN_[A-Z0-9_]+\b/g;

function contentFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...contentFiles(absolute));
		else if (entry.name.endsWith(".md")) files.push(absolute);
	}
	return files.sort();
}

function claims(pattern: RegExp): Map<string, Set<string>> {
	const found = new Map<string, Set<string>>();
	for (const file of contentFiles(CONTENT_DIR)) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(pattern)) {
			const path = relative(REPO_ROOT, file);
			const set = found.get(path) ?? new Set<string>();
			set.add(match[0]);
			found.set(path, set);
		}
	}
	return found;
}

describe("content restatements", () => {
	test("every env var the copy names is one warren ships", () => {
		const known = new Set<string>(facts.envVars);
		for (const [path, vars] of claims(ENV_VAR)) {
			for (const name of vars) {
				expect(known.has(name), `${path} names ${name}, which is not in facts.envVars`).toBe(true);
			}
		}
	});

	test("the copy actually exercises the env-var check", () => {
		// Guard the guard: if the copy stops naming any env var, the test
		// above passes vacuously and a regression here would go unseen.
		const all = new Set([...claims(ENV_VAR).values()].flatMap((set) => [...set]));
		expect(all.size).toBeGreaterThan(0);
	});

	test("every license the copy names is warren's license", () => {
		let mentions = 0;
		for (const [path, names] of claims(LICENSE_NAME)) {
			for (const name of names) {
				mentions += 1;
				expect(name, `${path} names the ${name} license; warren is ${facts.license}`).toBe(
					facts.license,
				);
			}
		}
		expect(mentions).toBeGreaterThan(0);
	});
});
