/**
 * Tests for the pinned-ref bumper the nightly sync workflow calls.
 *
 * The regression this suite exists for: the workflow's old shell verified
 * the bump with `git diff --quiet && { ...; exit 1; }`, which failed the
 * step exactly when the bump had worked. The invariant is now positive
 * and testable — a bump to a NEW tag returns changed content with only
 * the pin rewritten, and every degenerate case throws instead of leaking
 * an exit status through a shell list.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UPSTREAM } from "../src/config/upstream.ts";
import { bumpPinnedRef, readPinnedRef, runCli, UPSTREAM_CONFIG_PATH } from "./bump-upstream-ref.ts";

const FIXTURE = [
	"export const UPSTREAM = {",
	'\towner: "jayminwest",',
	'\trepo: "warren",',
	"\t/** Release tag the docs are built from. Bump to publish new docs. */",
	'\tref: "v0.12.2",',
	"} as const;",
	"",
].join("\n");

const realConfig = () => readFileSync(resolve(import.meta.dir, "..", UPSTREAM_CONFIG_PATH), "utf8");

describe("readPinnedRef", () => {
	test("extracts the tag from the ref field", () => {
		expect(readPinnedRef(FIXTURE)).toBe("v0.12.2");
	});

	test("reads the real config file and agrees with the UPSTREAM constant", () => {
		// The workflow greps the file while the site imports the module; this
		// pins the two views together so a restructure cannot split them.
		expect(readPinnedRef(realConfig())).toBe(UPSTREAM.ref);
	});

	test("throws when the UPSTREAM block was restructured", () => {
		expect(() => readPinnedRef('const REF = "v1.2.3";')).toThrow(/restructured/);
	});
});

describe("bumpPinnedRef", () => {
	test("rewrites only the pin when the target is a new tag", () => {
		const bumped = bumpPinnedRef(FIXTURE, "v0.13.1");
		expect(bumped).toBe(FIXTURE.replace('ref: "v0.12.2"', 'ref: "v0.13.1"'));
		expect(readPinnedRef(bumped)).toBe("v0.13.1");
	});

	test("returns content that differs from the input on a real bump", () => {
		// Regression: the workflow once treated "the file changed" as the
		// FAILURE condition. A successful bump must change the bytes.
		expect(bumpPinnedRef(FIXTURE, "v9.9.9")).not.toBe(FIXTURE);
	});

	test("round-trips against the real config file", () => {
		const source = realConfig();
		const bumped = bumpPinnedRef(source, "v99.0.0");
		expect(readPinnedRef(bumped)).toBe("v99.0.0");
		expect(bumpPinnedRef(bumped, UPSTREAM.ref)).toBe(source);
	});

	test("throws on a no-op bump instead of opening an empty pull request", () => {
		expect(() => bumpPinnedRef(FIXTURE, "v0.12.2")).toThrow(/changed nothing/);
	});

	test("rejects a target that is not a release tag", () => {
		for (const target of ["main", "0.13.1", "v0.13", "v0.13.1-rc.1", ""]) {
			expect(() => bumpPinnedRef(FIXTURE, target)).toThrow(/not a release tag/);
		}
	});

	test("throws rather than writing when the pin pattern is absent", () => {
		expect(() => bumpPinnedRef("nothing to see here", "v1.0.0")).toThrow(/restructured/);
	});
});

describe("runCli", () => {
	/** A quiet console that records what the CLI printed. */
	const capture = () => {
		const lines: string[] = [];
		const errors: string[] = [];
		return {
			lines,
			errors,
			io: { log: (line: string) => lines.push(line), error: (line: string) => errors.push(line) },
		};
	};

	const writeFixture = () => {
		const path = join(tmpdir(), `bump-ref-${Date.now()}-${Math.random()}.ts`);
		writeFileSync(path, FIXTURE);
		return path;
	};

	test("prints the pinned ref under --current and exits 0", () => {
		const path = writeFixture();
		const out = capture();
		expect(runCli(["--current"], path, out.io)).toBe(0);
		expect(out.lines).toEqual(["v0.12.2"]);
		rmSync(path);
	});

	test("rewrites the file on a bump and exits 0", () => {
		const path = writeFixture();
		const out = capture();
		expect(runCli(["v0.13.1"], path, out.io)).toBe(0);
		expect(readPinnedRef(readFileSync(path, "utf8"))).toBe("v0.13.1");
		expect(out.lines).toEqual([`${UPSTREAM_CONFIG_PATH}: v0.12.2 -> v0.13.1`]);
		rmSync(path);
	});

	test("exits 1 and leaves the file alone on a no-op bump", () => {
		const path = writeFixture();
		const out = capture();
		expect(runCli(["v0.12.2"], path, out.io)).toBe(1);
		expect(readFileSync(path, "utf8")).toBe(FIXTURE);
		expect(out.errors[0]).toMatch(/changed nothing/);
		rmSync(path);
	});

	test("exits 1 with usage when called without arguments", () => {
		const out = capture();
		expect(runCli([], "unused", out.io)).toBe(1);
		expect(out.errors[0]).toMatch(/usage/);
	});

	test("exits 1 with usage when called with extra arguments", () => {
		const out = capture();
		expect(runCli(["v1.0.0", "v2.0.0"], "unused", out.io)).toBe(1);
		expect(out.errors[0]).toMatch(/usage/);
	});
});
