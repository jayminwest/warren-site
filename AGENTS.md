# AGENTS.md

This file is the entry point for AI coding agents in this repository. It follows the [agents.md](https://agents.md) convention.

Prose paragraphs here stay on one line. The prose guard splits sentences per line, so a hard-wrapped paragraph reads as many short sentences and trips the paragraph-length rule.

## What this project is

This repository builds warren.run: the marketing site and the documentation for [warren](https://github.com/jayminwest/warren). The stack is Astro with the Starlight theme, and every page ships as static HTML.

The site copies nothing from warren by hand. One pinned upstream ref in `src/config/upstream.ts` names the release tag that every derived page comes from. A sync script pulls the API reference, the CLI reference, the SDK reference, the narrative docs, the changelog, and the design tokens at that ref. To publish new docs, bump the ref and run the sync.

## Tech stack at a glance

- **Runtime:** Bun. TypeScript runs directly, with no separate build step.
- **Site framework:** Astro with the Starlight documentation theme.
- **Language:** TypeScript in strict mode.
- **Lint and format:** Biome. Warnings fail the build.
- **Prose:** a machine-checkable subset of ASD-STE100, in `scripts/check-prose.ts`.
- **Output:** static HTML. There is no server and no database.

## Build and test commands

```bash
bun install                   # install dependencies
bun run dev                   # local dev server
bun run build                 # production build
bun run preview               # serve the production build
bun test                      # run all tests
bun run sync:upstream         # refresh the derived output from the pinned ref
```

## Quality gates

Run every gate before you commit. Warnings count as failures.

```bash
bun run check:all             # every gate, in order
bun run verify                # alias for check:all
```

`check:all` is the os-eco fleet quiet runner. The file `scripts/check-all.ts` is byte-identical to the copy in the fleet toolkit, and so is `scripts/check-ci-parity.ts`. Never edit either one here. All per-repo variation comes from `package.json` and `scripts/ci-parity-config.json`.

The runner prints one aligned status line per gate, then a tally. On failure it prints the failing gate names, parsed failure signatures, and a re-run hint. Set `CHECK_ALL_VERBOSE=1` for full output, or pass `--bail` to stop at the first failure.

The resolved manifest for this repository, in order:

```bash
bun run lint                  # biome, then the prose guard
bun run typecheck             # astro check, then tsc --noEmit
bun run check:agents          # this file stays accurate
bun run check:dups            # jscpd duplication budget
bun run check:deps            # knip unused-dependency scan
bun run check:size            # per-file line-count ratchet
bun run check:debt            # debt-marker ratchet
bun run check:bundle-size     # bundle budget, then the a11y sweep
bun run gen:docs:check        # derived docs match the pinned upstream ref
bun run check:coverage        # tests plus the coverage ratchet
bun run check:ci-parity       # CI and check:all agree
```

Run one gate by name at any time.

### Ratchets

Four gates read a budget file and fail when the repository regresses past it. Every budget started empty, because this repository started clean. A budget entry is a permanent record of something a gate let through, so fix the code instead.

- **`check:size`** reads `budgets/file-size-budgets.json`. Every TypeScript file under `src/` and `scripts/` stays at or below 500 lines. Split a large file rather than adding a budget entry.
- **`check:debt`** reads `budgets/debt-markers-budget.json`. A `TODO`, `FIXME`, `HACK`, or `XXX` marker needs a tracker reference on the same line. The allowlist is empty and stays empty.
- **`check:coverage`** reads `budgets/coverage-budgets.json`. The floors apply to the aggregate row of the Bun coverage table.
- **`check:prose`** reads `scripts/prose-budgets.json`. It runs as part of `bun run lint`, not as a separate gate.

Coverage measures logic only. The ignore list in `bunfig.toml` drops the presentational Astro paths, which two other gates cover instead: the a11y sweep and the Starlight link validator.

The size, debt, and prose ratchets only go down. The coverage ratchet only goes up. To loosen any of them, a human writes the commit and gives a reason.

### The prose guard

This is a marketing site, so the guard bans marketing adjectives on purpose. The full word list lives in `scripts/prose-rules.ts`. Describe what warren does and let the reader judge it.

The guard also flags long sentences, passive voice, nominalizations, phrasal verbs, semicolons, contractions, and Latin abbreviations. The tracked file list lives in `scripts/prose-budgets.json`, which accepts glob patterns. The guard skips a listed path that matches no file yet, and reports no error for it.

For per-file detail:

```bash
bun run check:prose
```

## Naming conventions

- **Filenames:** kebab-case for TypeScript. Tests are `<name>.test.ts` next to the file under test. Biome enforces this through its filename-convention rule.
- **Astro components:** PascalCase, which matches the framework convention. Biome does not parse `.astro` files, so `biome.json` excludes them.
- **Directories:** kebab-case.
- **Identifiers:** camelCase for functions and variables, PascalCase for types and components, SCREAMING_SNAKE_CASE for true module-level constants.
- **Test names:** `describe("<unit>")` plus `test("verb-led behaviour")`. No "should", no `it`.

## TypeScript conventions

- Strict mode. Handle every possible `undefined` from an index access.
- No `any`. Use `unknown` and narrow it, or write a real type.
- Import with `.ts` extensions.
- Tab indentation, 100-character line width. Biome enforces both.

## Where things live

- `src/` — the Astro site. `src/config/upstream.ts` pins the upstream ref.
- `content/` — authored marketing prose, tracked by the prose guard.
- `scripts/` — the quality gates and the upstream sync.
- `budgets/` — the JSON budget files that the ratchets read.
- `.github/workflows/ci.yml` — the CI pipeline, one step per gate.

## Continuous integration

CI runs one step per manifest gate, in manifest order. The `bun run check:ci-parity` gate proves both directions of that claim. No CI step invokes a script the manifest cannot reach, and no manifest gate goes missing from CI. The only sanctioned divergences live in `scripts/ci-parity-config.json`, and each one carries a reason.

## Before you finish

1. Run `bun run check:all` and get a clean result.
2. Keep this file accurate. The `bun run check:agents` gate checks every command and every path named here.
3. Commit the budget files with the code that changed them.
