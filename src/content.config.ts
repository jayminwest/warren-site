import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

/**
 * Content collections for the site.
 *
 * `docs` is Starlight's collection. Its entries live in
 * `src/content/docs/` and are, with the exception of a handful of
 * hand-written pages, GENERATED: `bun run sync:upstream` writes warren's
 * narrative docs into `src/content/docs/docs/` at the pinned ref (see
 * `src/config/upstream.ts`), `starlight-openapi` renders `/docs/api/`
 * from the upstream OpenAPI schema, and `starlight-typedoc` writes
 * `/docs/sdk/` from the upstream TypeScript client. Do not hand-edit a
 * generated page; edit it upstream and re-sync.
 *
 * The schema is Starlight's own, unextended. Generated pages carry only
 * the frontmatter the sync script writes (`title`, `description`,
 * `editUrl`), so any custom field added here would have to be optional
 * anyway — add one only when a hand-written page actually needs it.
 */
export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
