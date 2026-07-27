/**
 * Budget shapes and re-baselining policy for `scripts/check-bundle-size.ts`.
 *
 * Split out of that script for the same reason `prose-rules.ts` is split out
 * of `check-prose.ts`: the measuring half talks to the filesystem, this half is
 * pure policy, and keeping them apart lets the policy be tested exhaustively
 * without a build. The measurement types live here too so both halves agree on
 * one vocabulary.
 *
 * The one rule worth stating up front, because it is what the whole file
 * exists to enforce: LOWERING A BUDGET ALWAYS APPLIES. Raising is bounded, and
 * raising a budget that currently sits at ZERO is refused outright.
 */

export type Bucket = "js" | "css";
export const BUCKETS: readonly Bucket[] = ["js", "css"] as const;

/** Churn headroom added to a measured size when re-baselining via `--update`. */
export const HEADROOM_RAW = 800;
export const HEADROOM_GZIP = 400;
/** Per-route headroom. Applied only to a NON-zero measurement — see `apply`. */
export const HEADROOM_ROUTE_RAW = 512;
export const HEADROOM_ROUTE_SCRIPTS = 2;

/**
 * Bounded auto-raise caps for `--update`. Growth within the cap re-baselines
 * hands-free (ordinary content and feature churn); anything larger is refused
 * and needs a deliberate `WARREN_SITE_BUNDLE_SIZE_ALLOW_RAISE=1`, which is what
 * a heavy new dependency should feel like.
 */
export const AUTO_RAISE_CAP: { raw: Record<Bucket, number>; gzip: Record<Bucket, number> } = {
	raw: { js: 24576, css: 12288 },
	gzip: { js: 8192, css: 4096 },
};
export const ROUTE_AUTO_RAISE_CAP = { scripts: 4, raw: 8192 };

export interface RouteBudget {
	scripts: number;
	raw: number;
}

export interface Budgets {
	totals: { raw: Record<Bucket, number>; gzip: Record<Bucket, number> };
	largest: { gzip: Record<Bucket, number> };
	routes: Record<string, RouteBudget>;
	routeDefault: RouteBudget;
}

export interface AssetMeasurement {
	name: string;
	bucket: Bucket;
	raw: number;
	gzip: number;
}

export interface RouteMeasurement extends RouteBudget {
	route: string;
}

export interface Measurement {
	totals: { raw: Record<Bucket, number>; gzip: Record<Bucket, number> };
	largest: { gzip: Record<Bucket, number> };
	assets: AssetMeasurement[];
	routes: RouteMeasurement[];
}

export interface Failure {
	metric: string;
	scope: string;
	actual: number;
	budget: number;
}

export interface UpdateResult {
	budgets: Budgets;
	refused: string[];
	autoRaised: string[];
}

function assertNonNegativeInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

function parseRouteBudget(value: unknown, label: string): RouteBudget {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object with "scripts" and "raw"`);
	}
	const v = value as Record<string, unknown>;
	return {
		scripts: assertNonNegativeInt(v.scripts, `${label}.scripts`),
		raw: assertNonNegativeInt(v.raw, `${label}.raw`),
	};
}

export function parseBudgets(raw: unknown, label = "bundle-size budgets"): Budgets {
	if (raw === null || typeof raw !== "object") throw new Error(`${label}: not an object`);
	const r = raw as Record<string, unknown>;
	const totals = r.totals as Record<string, Record<string, unknown>> | undefined;
	const largest = r.largest as Record<string, Record<string, unknown>> | undefined;
	if (!totals?.raw || !totals.gzip || !largest?.gzip) {
		throw new Error(`${label}: missing totals.raw / totals.gzip / largest.gzip`);
	}
	const out: Budgets = {
		totals: { raw: { js: 0, css: 0 }, gzip: { js: 0, css: 0 } },
		largest: { gzip: { js: 0, css: 0 } },
		routes: {},
		routeDefault: parseRouteBudget(r.routeDefault, `${label}: routeDefault`),
	};
	for (const b of BUCKETS) {
		out.totals.raw[b] = assertNonNegativeInt(totals.raw[b], `${label}: totals.raw.${b}`);
		out.totals.gzip[b] = assertNonNegativeInt(totals.gzip[b], `${label}: totals.gzip.${b}`);
		out.largest.gzip[b] = assertNonNegativeInt(largest.gzip[b], `${label}: largest.gzip.${b}`);
	}
	const routes = r.routes;
	if (routes === null || typeof routes !== "object" || Array.isArray(routes)) {
		throw new Error(`${label}: "routes" must be an object`);
	}
	for (const [route, value] of Object.entries(routes as Record<string, unknown>)) {
		out.routes[route] = parseRouteBudget(value, `${label}: routes["${route}"]`);
	}
	return out;
}

export function diff(m: Measurement, budgets: Budgets): Failure[] {
	const failures: Failure[] = [];
	const push = (metric: string, scope: string, actual: number, budget: number): void => {
		if (actual > budget) failures.push({ metric, scope, actual, budget });
	};
	for (const b of BUCKETS) {
		push("totals.raw", b, m.totals.raw[b], budgets.totals.raw[b]);
		push("totals.gzip", b, m.totals.gzip[b], budgets.totals.gzip[b]);
		push("largest.gzip", b, m.largest.gzip[b], budgets.largest.gzip[b]);
	}
	for (const r of m.routes) {
		const explicit = budgets.routes[r.route];
		const budget = explicit ?? budgets.routeDefault;
		const which = explicit ? "route" : "routeDefault";
		push(`${which}.scripts`, r.route, r.scripts, budget.scripts);
		push(`${which}.raw`, r.route, r.raw, budget.raw);
	}
	return failures;
}

/**
 * Recompute budgets from a measurement. Lowering ALWAYS applies. Raising is
 * allowed only within the auto-raise caps, and never at all for a budget that
 * currently sits at zero — a zero is the whole point of the landing-route
 * entries, so promoting one off zero has to be a deliberate human act.
 *
 * Headroom is skipped when the measurement is 0, so a route that ships no JS
 * re-baselines to exactly 0 and stays locked rather than drifting up to 512.
 */
export function updateBudgets(
	m: Measurement,
	current: Budgets,
	allowRaise = process.env.WARREN_SITE_BUNDLE_SIZE_ALLOW_RAISE === "1",
): UpdateResult {
	const refused: string[] = [];
	const autoRaised: string[] = [];
	const next: Budgets = {
		totals: { raw: { js: 0, css: 0 }, gzip: { js: 0, css: 0 } },
		largest: { gzip: { js: 0, css: 0 } },
		routes: {},
		routeDefault: { scripts: 0, raw: 0 },
	};

	const apply = (cur: number, measured: number, headroom: number, cap: number, label: string) => {
		const proposed = measured === 0 ? 0 : measured + headroom;
		if (proposed <= cur) return proposed;
		if (allowRaise) return proposed;
		if (cur === 0) {
			refused.push(`${label}: 0 → ${proposed} (locked at zero)`);
			return cur;
		}
		const delta = proposed - cur;
		if (delta <= cap) {
			autoRaised.push(`${label}: ${cur} → ${proposed} (+${delta}, within ${cap} cap)`);
			return proposed;
		}
		refused.push(`${label}: ${cur} → ${proposed} (+${delta}, exceeds ${cap} cap)`);
		return cur;
	};

	for (const b of BUCKETS) {
		const hRaw = b === "js" ? HEADROOM_RAW : Math.round(HEADROOM_RAW / 2);
		const hGz = b === "js" ? HEADROOM_GZIP : Math.round(HEADROOM_GZIP / 2);
		const t = `totals`;
		next.totals.raw[b] = apply(
			current.totals.raw[b],
			m.totals.raw[b],
			hRaw,
			AUTO_RAISE_CAP.raw[b],
			`${t}.raw.${b}`,
		);
		next.totals.gzip[b] = apply(
			current.totals.gzip[b],
			m.totals.gzip[b],
			hGz,
			AUTO_RAISE_CAP.gzip[b],
			`${t}.gzip.${b}`,
		);
		next.largest.gzip[b] = apply(
			current.largest.gzip[b],
			m.largest.gzip[b],
			hGz,
			AUTO_RAISE_CAP.gzip[b],
			`largest.gzip.${b}`,
		);
	}

	const applyRoute = (cur: RouteBudget, measured: RouteBudget, label: string): RouteBudget => ({
		scripts: apply(
			cur.scripts,
			measured.scripts,
			HEADROOM_ROUTE_SCRIPTS,
			ROUTE_AUTO_RAISE_CAP.scripts,
			`${label}.scripts`,
		),
		raw: apply(cur.raw, measured.raw, HEADROOM_ROUTE_RAW, ROUTE_AUTO_RAISE_CAP.raw, `${label}.raw`),
	});

	// Unlisted routes all answer to routeDefault, so it re-baselines from the
	// worst of them rather than from any single page.
	const fallbackMax: RouteBudget = { scripts: 0, raw: 0 };
	for (const r of m.routes) {
		const explicit = current.routes[r.route];
		if (explicit) {
			next.routes[r.route] = applyRoute(explicit, r, `routes["${r.route}"]`);
			continue;
		}
		fallbackMax.scripts = Math.max(fallbackMax.scripts, r.scripts);
		fallbackMax.raw = Math.max(fallbackMax.raw, r.raw);
	}
	next.routeDefault = applyRoute(current.routeDefault, fallbackMax, "routeDefault");

	return { budgets: next, refused, autoRaised };
}
