/**
 * Single source of truth for the upstream warren repository.
 *
 * Every generated surface on this site — the API reference, the CLI
 * reference, the SDK reference, the narrative docs, and the changelog —
 * derives from warren at ONE pinned ref. Nothing on this site restates
 * upstream content by hand.
 *
 * The ref is a release tag, not `main`, so `/docs/` describes the version
 * a reader can actually install rather than unreleased work. Bumping
 * `REF` is the entire "publish new docs" operation; `bun run
 * sync:upstream` refreshes the derived artifacts and `bun run
 * gen:docs:check` fails CI when they drift.
 */

export const UPSTREAM = {
	owner: "jayminwest",
	repo: "warren",
	/** Release tag the docs are built from. Bump to publish new docs. */
	ref: "v0.13.2",
} as const;

/** Raw file base for the pinned ref, e.g. `<base>/README.md`. */
export const RAW_BASE =
	`https://raw.githubusercontent.com/${UPSTREAM.owner}/${UPSTREAM.repo}/${UPSTREAM.ref}` as const;

/** Blob base for human-facing "edit this page" / source links. */
export const BLOB_BASE =
	`https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/blob/${UPSTREAM.ref}` as const;

/** Clone URL used by `sync:upstream` for the TypeDoc + CLI extractors. */
export const CLONE_URL = `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}.git` as const;

/**
 * Narrative docs pulled verbatim from warren's `docs/` tree.
 *
 * `source` is relative to the repo root at the pinned ref. `slug` is the
 * route under `/docs/`. `title` overrides the document's own H1 in the
 * sidebar when the upstream title is too long or too internal.
 */
export type UpstreamDoc = {
	readonly source: string;
	readonly slug: string;
	readonly title: string;
	readonly group: string;
};

export const UPSTREAM_DOCS: readonly UpstreamDoc[] = [
	{ source: "README.md", slug: "quickstart", title: "Quickstart", group: "Start here" },
	{
		source: "docs/project-setup.md",
		slug: "project-setup",
		title: "Project setup",
		group: "Start here",
	},
	{
		source: "docs/RUNBOOK-K8S.md",
		slug: "self-host/kubernetes",
		title: "Kubernetes",
		group: "Self-host",
	},
	{
		source: "docs/PHILOSOPHY.md",
		slug: "concepts/philosophy",
		title: "Philosophy",
		group: "Concepts",
	},
	{
		source: "docs/CONSTITUTION.md",
		slug: "concepts/constitution",
		title: "Constitution",
		group: "Concepts",
	},
	{
		source: "docs/design/runtime-provider-contract.md",
		slug: "concepts/runtimes",
		title: "Runtime providers",
		group: "Concepts",
	},
	{ source: "docs/labels.md", slug: "reference/labels", title: "Labels", group: "Reference" },
];

/** OpenAPI schema rendered by starlight-openapi. */
export const OPENAPI_URL = `${RAW_BASE}/docs/openapi.yaml` as const;

/** Changelog source for the generated `/changelog` page. */
export const CHANGELOG_URL = `${RAW_BASE}/CHANGELOG.md` as const;
