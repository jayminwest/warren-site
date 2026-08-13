/**
 * Single source of truth for the analytics scripts every page carries.
 *
 * Two consumers render these: `BaseLayout.astro` for the standalone pages
 * (`/`, `/changelog`) and the Starlight `head` entries in
 * `astro.config.mjs` for every docs route. Keeping the tag list here means
 * the two chromes cannot drift apart.
 *
 * VERCEL WEB ANALYTICS — the script ships unconditionally. `/_vercel/
 * insights/script.js` is served by the Vercel edge when Web Analytics is
 * enabled for the project; on a local build the request 404s and the page
 * carries on. No package dependency, no configuration.
 *
 * GOOGLE ADS TAG — renders ONLY when `PUBLIC_GTAG_ID` is set at build
 * time (an `AW-…` conversion id or `G-…` measurement id). Set it in the
 * Vercel project's environment variables; CI builds without it, so the
 * bundle-size gate measures the Vercel-analytics-only shape and the
 * per-route budgets carry headroom for the full production shape (see
 * `$comment_routes` in `budgets/bundle-size-budgets.json`).
 *
 * These are the ONLY client scripts the standalone pages may ship. The
 * zero-JS constraint on `/` and `/changelog` was relaxed to exactly this
 * list on 2026-08-13 for ad-campaign measurement — analytics, nothing
 * else. Hydration islands and prefetch stay banned.
 */

/**
 * Google tag id (`AW-…` / `G-…`), or undefined outside Vercel builds.
 *
 * Read from `process.env`, not `import.meta.env`: this module is imported
 * by `astro.config.mjs`, which Astro bundles OUTSIDE Vite, where
 * `import.meta.env` does not exist. The whole site is prerendered, so the
 * component consumers read it at build time in Node all the same.
 */
export const GTAG_ID: string | undefined = process.env.PUBLIC_GTAG_ID;

/** Vercel Web Analytics collector, served by the Vercel edge in prod. */
export const VERCEL_INSIGHTS_SRC = "/_vercel/insights/script.js" as const;

/** External loader for the Google tag. */
export const gtagLoaderSrc = (id: string): string =>
	`https://www.googletagmanager.com/gtag/js?id=${id}`;

/**
 * Optional Google Ads conversion `send_to` target
 * (`AW-XXXXXXXXX/ConversionLabel`), set alongside `PUBLIC_GTAG_ID` once
 * the conversion action exists in the Ads account. Without it the outbound
 * click still fires as a plain `github_click` event, which Google Ads can
 * import from GA4 instead.
 */
export const GTAG_SEND_TO: string | undefined = process.env.PUBLIC_GTAG_SEND_TO;

/**
 * Inline bootstrap for the Google tag: the canonical four lines, plus a
 * delegated click listener that reports outbound clicks to the warren
 * GitHub repo. The ad campaign's goal is repo traffic (stars), and GitHub
 * cannot report a star back to us, so the click that leaves for the repo
 * IS the conversion this site can measure.
 */
export const gtagBootstrap = (id: string, sendTo?: string): string =>
	[
		"window.dataLayer = window.dataLayer || [];",
		"function gtag(){dataLayer.push(arguments);}",
		"gtag('js', new Date());",
		`gtag('config', '${id}');`,
		"document.addEventListener('click', function (e) {",
		"  var t = e.target instanceof Element ? e.target.closest('a[href^=\"https://github.com/jayminwest/warren\"]') : null;",
		"  if (!t) return;",
		"  gtag('event', 'github_click', { transport_type: 'beacon', event_callback: function () {} });",
		...(sendTo
			? [`  gtag('event', 'conversion', { send_to: '${sendTo}', transport_type: 'beacon' });`]
			: []),
		"});",
	].join("\n");
