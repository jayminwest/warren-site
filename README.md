# warren-site

Marketing site and documentation for [warren](https://github.com/jayminwest/warren). The site runs at warren.run.

Astro and Starlight build the pages. The design tokens come from warren's own web UI, so the site and the product render the same colors, fonts, radii, and shadows.

## The rule this repo follows

The site never restates warren by hand. Every documentation page derives from the warren repository at one pinned ref, and `src/config/upstream.ts` holds that ref. Bumping `UPSTREAM.ref` publishes new documentation. Nothing else changes.

`bun run sync:upstream` fetches warren at the pinned ref and writes the derived output. `bun run gen:docs:check` runs the same generator and fails when the committed output drifts. That gate runs on every pull request.

Six surfaces derive from warren:

| Surface | Source |
| --- | --- |
| `/docs/api/` | `docs/openapi.yaml`, rendered by starlight-openapi |
| `/docs/sdk/` | `src/client/`, rendered by starlight-typedoc |
| `/docs/reference/cli` | a static parse of `src/cli/main.ts` |
| Narrative docs | the files listed in `UPSTREAM_DOCS` |
| `/changelog` | `CHANGELOG.md` |
| `src/styles/warren-theme.css` | the token blocks in `src/ui/src/index.css` |

Marketing copy lives in `content/` and belongs to this repo alone.

## Commands

```bash
bun install
bun run sync:upstream    # fetch warren at the pinned ref, write derived output
bun run dev              # local dev server
bun run build            # static build into dist/
bun run verify           # every quality gate, the agent-facing entry point
```

## Quality gates

`bun run check:all` runs the os-eco fleet's canonical gate suite. `bun run verify` is the same command under the name agents use. Eleven gates run: lint, typecheck, check:agents, check:dups, check:deps, check:size, check:debt, check:bundle-size, gen:docs:check, check:coverage, and check:ci-parity.

Two gates deserve a note.

`check:bundle-size` holds the landing page and the changelog page at zero scripts. The budget for those two routes locks to zero, and a re-baseline cannot raise it without an explicit environment override. A change that puts JavaScript back on the landing page fails the build. The same gate runs an accessibility audit over every built page and fails on serious or critical axe violations.

`check:prose` runs inside `lint`. It enforces a machine-checkable subset of ASD-STE100 Simplified Technical English over `content/**/*.md` and this file, at zero violations with nothing grandfathered. The rules ban marketing adjectives, passive voice, sentences over 25 words, and contractions. Plain technical language is the house voice, and this gate holds the line.

## Deployment

Vercel builds and serves the site. `vercel.json` sets the build command to `bun run sync:upstream && bun run build`.

The sync step has to run first. The generator writes the SDK reference into `src/content/docs/docs/sdk/`, and `.gitignore` covers that directory. A build without the sync step publishes the site with `/docs/sdk/` missing.

Every other derived output does live in git. The sync step rewrites those files to the same bytes. It fails the build only when the pinned ref has drifted.

Vercel validates `vercel.json` against a strict schema and rejects any key it does not define. Comments do not belong in that file. Record deployment reasoning here instead.

## License

MIT.
