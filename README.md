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

`check:bundle-size` holds the landing page and the changelog page to the analytics tags in `src/config/analytics.ts` and nothing more. The per-route budget counts those scripts, and a re-baseline cannot raise a locked budget without an explicit environment override. A change that puts more JavaScript on the landing page fails the build. The same gate runs an accessibility audit over every built page and fails on serious or critical axe violations.

`check:prose` runs inside `lint`. It enforces a machine-checkable subset of ASD-STE100 Simplified Technical English over `content/**/*.md` and this file, at zero violations with nothing grandfathered. The rules ban marketing adjectives, passive voice, sentences over 25 words, and contractions. Plain technical language is the house voice, and this gate holds the line.

## Deployment

Vercel builds and serves the site. `vercel.json` sets the build command to `bun run sync:upstream && bun run build`.

Analytics run from two sources. The Vercel Web Analytics script ships on every page and reports when you turn on Web Analytics in the Vercel project. The Google tag renders only when the build sees `PUBLIC_GTAG_ID`. When `PUBLIC_GTAG_SEND_TO` names a conversion action, the tag also reports a conversion on each outbound click to the warren repository. Set both variables in the Vercel project, not in this repository.

The sync step has to run first. The generator writes the SDK reference into `src/content/docs/docs/sdk/`, and `.gitignore` covers that directory. A build without the sync step publishes the site with `/docs/sdk/` missing.

Every other derived output does live in git. The sync step rewrites those files to the same bytes. It fails the build only when the pinned ref has drifted.

Vercel validates `vercel.json` against a strict schema and rejects any key it does not define. Comments do not belong in that file. Record deployment reasoning here instead.

### Why the build script sets `BASE_URL`

The `build` script reads `BASE_URL=/ astro build`. That prefix is load-bearing. Do not drop it.

`starlight-links-validator` reads `import.meta.env.BASE_URL` inside its `astro:build:done` hook. Astro integration code runs in the host runtime rather than through Vite, so the value depends on which runtime starts `astro build`. Node gets the value from Vite and works. Bun maps `import.meta.env` onto `process.env`, where the name is absent, and the plugin crashes on an undefined path.

Vercel starts the build under Bun. A local `bun run build` starts it under Node through the `astro` shebang. The same command therefore passed locally and failed on Vercel until the script set the name. Reproduce the failure with `bun --bun run build`.

The site sets no `base` in `astro.config.mjs`, so `/` is the correct value. Vite ignores the environment variable for modules it compiles, which leaves one value on both paths.

## License

MIT.
