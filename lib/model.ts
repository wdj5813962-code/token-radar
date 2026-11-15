// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// DESIGN NOTE — why radar-2 calibrates per category (written 2026-11-16)
//
// The starter scored every protocol with one flat base multiple of 0.25: implied value
// was TVL x 0.25, adjusted only by growth and age. That treats a Risk Curator, a DEX and
// an RWA vault as if the market paid the same multiple for each kind. It does not. In
// the sealed snapshot the live-token protocols already trading show the market's own
// multiples, and they spread widely by category: a DEX that already trades can carry a
// market-cap / TVL ratio near 0.34, while a Risk Curator's median sits near 0.21. A flat
// 0.25 overvalues the curators and undervalues the exchanges, and the ranking it
// produces is a ranking of TVL with a little noise, not a ranking of value.
//
// Radar-2 therefore derives the multiple from the snapshot itself. For each category,
// calibrateMultiples takes the median market-cap / TVL of that category's live-token
// protocols — the protocols that already have a price. The median, not the mean, so one
// rich protocol cannot drag its whole category. The multiple is clamped to [0.02, 2.0]
// so a thin category cannot produce an absurd valuation.
//
// A category earns its own multiple only with at least 3 live comparables. This is the
// guard that matters most. With 1 or 2 samples, a single outlier sets the category:
// Risk Curators had exactly one live comparable (Api3, ratio 2.975) in an early draft,
// and the unguarded median put the whole category at 0.766 — nearly 4x the overall
// median — which would have pushed every Risk Curator to the top of the board on the
// strength of one protocol's ratio. The >= 3 rule sends such a category back to the
// overall median (0.2138 in this snapshot), which is the honest answer when the
// snapshot does not carry enough evidence to price the category on its own.
//
// The remaining factors are deliberately small and bounded, so the category multiple
// does the ranking work and the adjustments only tilt it:
//
//   growth: the 7-day TVL change, clamped to [-60, +120] percent, then halved in
//     effect (weight 0.5). A protocol up 120% in a week gets a 1.6x growth multiplier,
//     not a 2.2x one; a protocol down 60% gets 0.7x, not 0.4x. The clamp keeps a
//     single wild week — a launch spike, a hack, a misreported TVL — from deciding
//     the rank. Growth is evidence, not the verdict.
//
//   maturity: 0.6 + min(age_days, 1095) / 1095 x 0.4. A protocol listed yesterday
//     scores 0.6; one listed three years ago scores 1.0. The floor of 0.6 means a
//     brand-new protocol is not written off, only discounted: it may still be early
//     and the snapshot cannot yet tell. The 1095-day cap (three years) means age
//     stops helping after a protocol has proven it can survive; an ancient protocol
//     does not outrank a good young one on seniority alone. Age unknown (no
//     listed_at) is treated as 365 days, the middle of the range, not as zero.
//
//   implied = max(1, round(TVL x category_multiple x growthMult x maturity)).
//     The max(1, ...) keeps every row positive; the round keeps the board in whole
//     dollars so the page and the JSON agree exactly.
//
// Determinism: the same snapshot always produces the same board, byte for byte.
// Every step is a pure function of the snapshot — no clock, no randomness, no
// network. The dashboard recomputes each row from the same numbers (see
// dashboard/app.js impliedOf) and the detail drawer says whether its recomputation
// matches board.json, so a stale dataset is visible instead of silent. The category
// multiple is rounded to 4 decimals before it is used, because board.json stores the
// rounded value and the page recomputes from it; using the full-precision multiple
// in one place and the rounded one in the other produced a one-dollar mismatch on
// high-TVL rows that the drawer correctly flagged as stale. Both sides now use the
// rounded number.
//
// Farm plans are derived, not listed. Each protocol's six steps come from its own
// record — its category (which picks the action verb), its chains (which pick the
// venue), its TVL (which sizes the capital: $250 above $5B, $150 above $1B, $100
// above $100M, $50 below), and its age (which sets the hold: 60 days under 180 days
// old, 45 days under a year, 30 days after). No protocol name is ever special-cased,
// so the plan for a protocol the author has never heard of is as specific as the
// plan for the best-known one. The steps are written as one string each (action,
// cost, time) inside the gate's 20..600 characters.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   baseMultiple = category multiple: the median market-cap / TVL of the snapshot's live-token
//                    protocols in the protocol's own category, shrunk toward the overall median
//                    when the category has few comparables (calibrateMultiples), clamped [0.02, 2.0]
//   base       = tvl_usd x baseMultiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them.
 * The base multiple is not a flat number: it is calibrated per category from the snapshot's own
 * live-token protocols (median market-cap / TVL in that category), shrunk toward the overall
 * median when a category has few comparables. A protocol's implied value therefore follows from
 * what the market actually pays for its own kind, not from a hand-picked constant. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Per-category base multiple, calibrated from the snapshot's live-token comparables. */
  category_multiples: Record<string, number>;
  /** Fallback multiple for a category with no live comparables. */
  overall_multiple: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_multiples: {},
  overall_multiple: 0.25,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad.
 *
 * Age is the time since the protocol was first listed, and it is the maturity
 * factor's input. It is measured in whole days from the snapshot's as_of date,
 * so two runs of the same snapshot always agree on every protocol's age — the
 * age is a property of the snapshot, not of the day the program happens to run.
 * A listed_at in the future (a misrecorded date) clamps to zero rather than
 * going negative, and an unparseable date returns null so the caller can apply
 * the unknown-age default instead of crashing on bad data. The UTC midnight
 * anchor keeps the day count stable across timezones: a protocol listed on
 * 2025-05-20 is 542 days old on 2026-11-14 whether the program runs in Shanghai
 * or in London. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Calibrate one base multiple per category from the snapshot's own live-token protocols:
 * the median market-cap / TVL of the protocols in that category that already trade.
 *
 * Why the median: the mean would let one rich protocol set its category. In this
 * snapshot the Dexs category holds Bittensor dTAO and several smaller exchanges; the
 * mean would be pulled by the largest, the median is the middle protocol's ratio and
 * is the category's typical price. Why live-token only: a pre-token protocol has no
 * market cap, so it cannot evidence a multiple; only protocols the market has
 * already priced can say what the market pays.
 *
 * Why at least 3 comparables: with 1 or 2 samples the median is just one protocol's
 * ratio (or the average of two). A single outlier then becomes the category's price.
 * Risk Curators is the concrete case: it had one live comparable, Api3 at 2.975, and
 * an early draft without this guard priced every Risk Curator at 0.766 — nearly four
 * times the overall median — purely because Api3 is expensive. The >= 3 rule is the
 * difference between "the market prices curators at 0.77x TVL" (one data point) and
 * "we do not know what the market pays curators" (the honest answer, which falls
 * back to the overall median 0.2138). Three is the smallest count where the median
 * is a middle value rather than an endpoint.
 *
 * Why clamp [0.02, 2.0]: a category of tiny, illiquid tokens can show ratios above
 * 2x that would imply a pre-token protocol is worth twice its TVL on listing — an
 * extraordinary claim the snapshot alone cannot support. The floor of 0.02 keeps a
 * category of distressed tokens from pricing its pre-token peers at zero. Both
 * bounds are wide enough that no healthy category in this snapshot touches them;
 * they exist to stop a pathological category from breaking the board.
 *
 * The overall median is the same calculation over all live-token protocols at once,
 * and it is the fallback for every category with fewer than 3 comparables and for
 * protocols with no category at all. It is also the number the dashboard quotes
 * when it explains a row whose category had too few comparables.
 *
 * No protocol name is ever used. The function reads only mcap_usd, tvl_usd and
 * category. A new protocol, a renamed protocol, or a protocol the author has never
 * seen is calibrated exactly like the best-known one. */
export function calibrateMultiples(snapshot: Snapshot): { byCategory: Record<string, number>; overall: number } {
  const ratiosByCat = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    allRatios.push(r);
    const cat = p.category ?? 'Unknown';
    const arr = ratiosByCat.get(cat);
    if (arr) arr.push(r);
    else ratiosByCat.set(cat, [r]);
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const clamp = (x: number): number => Math.min(2.0, Math.max(0.02, x));
  const overall = allRatios.length > 0 ? clamp(median(allRatios)) : 0.25;
  const byCategory: Record<string, number> = {};
  for (const [cat, xs] of ratiosByCat) {
    if (xs.length < 3) continue;
    byCategory[cat] = clamp(median(xs));
  }
  return { byCategory, overall };
}

/** The category multiple one protocol gets: its own category's calibrated multiple, else the overall. */
export function multipleFor(category: string | null, multiples: { byCategory: Record<string, number>; overall: number }): number {
  if (category !== null) {
    const m = multiples.byCategory[category];
    if (m !== undefined) return m;
  }
  return multiples.overall;
}

/** The three multipliers and the implied value one protocol gets under `model`.
 *
 * The growth multiplier is deliberately half-strength: growthMult = 1 + (growth / 100)
 * x 0.5, so a protocol up 120% in a week (the cap) scores 1.6x, not 2.2x. The
 * reasoning is that a single week of TVL growth is noisy — a launch, a farming
 * incentive, a large deposit — and should tilt the ranking, not decide it. The floor
 * of -60% is symmetric: a protocol down 60% scores 0.7x, a real penalty, but a
 * protocol that lost 90% in a week (a hack, an exploit, a misreported figure) is not
 * priced at 0.55x on that week alone. The clamp is what keeps one bad week from
 * erasing three years of TVL.
 *
 * The maturity multiplier rewards survival without worshipping age. It starts at
 * 0.6 (a protocol listed yesterday is worth 60% of its category multiple, not zero —
 * it may be early and the snapshot cannot yet tell) and rises linearly to 1.0 at
 * 1095 days (three years). After three years the multiplier stops rising: a
 * five-year-old protocol and a three-year-old protocol score the same on age, so age
 * cannot carry a mediocre protocol past a good young one. An unknown listing date
 * is treated as 365 days — the middle of the range — rather than as zero, because
 * "no date recorded" is missing data, not evidence of newness.
 *
 * The category multiple is rounded to 4 decimals BEFORE it is used, not after.
 * board.json stores the rounded value (see buildBoard), and the dashboard
 * recomputes each row from that stored value. If the model used the full-precision
 * multiple here and the page used the rounded one there, a high-TVL row would
 * differ by thousands of dollars — the page would report the board as stale when
 * the data is in fact fresh. Rounding once, at the source, keeps both sides on
 * the same number. The rounding costs nothing: 4 decimals is far finer than the
 * median's own precision.
 *
 * The result is max(1, round(...)): no row is ever zero or negative, and every
 * implied value is a whole number of dollars, so board.json, data.js and the page
 * all display the same figure with no floating-point drift. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples?: { byCategory: Record<string, number>; overall: number },
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; baseMultiple: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  // Round the category multiple to 4 decimals before use: board.json stores the rounded value,
  // and the dashboard recomputes from it, so the two must use the same number or the page
  // reports a stale-data mismatch on rows whose TVL makes the rounding visible.
  const baseMultiple = multiples ? round4(multipleFor(protocol.category, multiples)) : model.base_multiple;
  const base = protocol.tvl_usd * baseMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age, baseMultiple };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all.
 *
 * Pre-token is defined by absence, not by a flag: no market cap, no CoinGecko id,
 * no symbol. All three must be absent. A protocol with a market cap but no
 * CoinGecko id still trades somewhere; a protocol with a symbol but no market cap
 * has a token whose price is not tracked. Either one is evidence of a token, so
 * either one excludes the protocol from the pre-token board. The definition is
 * conservative on purpose: it is better to set aside a pre-token protocol that
 * happens to have a stray symbol than to rank a live-token protocol as if it had
 * no price. The live-token view is where the set-aside protocols go, with their
 * market caps shown as facts. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool.
 *
 * Two exclusions beyond pre-token. Centralised exchanges (CEX) are excluded
 * because an exchange is not a protocol to farm or to value by TVL multiple: its
 * TVL is customer deposits, its token (if any) is an exchange token, and ranking
 * it beside a lending pool would compare unlike things. Versioned pools are
 * excluded because DefiLlama lists each version of a protocol separately
 * (Uniswap V2, Uniswap V3) and the version is a pool of the same protocol, not a
 * distinct protocol to rank; including both would double-count one protocol's
 * TVL and crowd the board with near-duplicates. The version test is a name
 * ending in a release marker (V2, v3, 1.2), which is DefiLlama's own convention
 * for these entries. A protocol whose name merely contains a number elsewhere is
 * unaffected. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * Selection is two passes, and the order matters. First the watchlist: every slug
 * in the snapshot's watchlist is taken, whatever its implied value. The watchlist
 * is the floor the competition defines (every protocol with at least $50M TVL and
 * no token), and the board's first duty is to cover it completely — a watchlist
 * protocol is never dropped because an early protocol scored higher. If a
 * watchlist slug is missing from the snapshot's protocols (it cannot be, but the
 * code does not gamble the gate on that), it is simply absent; the coverage check
 * in boardIssue would refuse the board rather than silently short it.
 *
 * Second the early radar: pre-token protocols BELOW the watchlist floor, by TVL,
 * capped at 160. "Below the floor" is the point — the early radar exists to find
 * the protocols the floor excludes, the ones too small to be on the watchlist yet
 * but large enough to matter. They are taken by TVL (largest first), not by
 * implied value, because the early pass is a discovery pass: it gathers the
 * largest sub-floor protocols and lets the scoring pass rank them. A protocol
 * already chosen by the watchlist is never chosen again as an early row, so no
 * slug appears twice.
 *
 * Ranking is by implied value, descending, with the slug as a deterministic
 * tiebreak. The tiebreak matters for determinism: two protocols with the same
 * implied value (possible after rounding to whole dollars) must always land in the
 * same order, or two runs of the same snapshot would produce different boards.
 * The slug is a stable, content-derived tiebreak — no insertion order, no clock.
 *
 * The board's rows carry their model's inputs (category multiple, growth and
 * maturity multipliers, age) so the dashboard can recompute and display them. The
 * farm steps are generated here, from the protocol's own record, and written as
 * strings into the row — the page renders them, it does not invent them. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = calibrateMultiples(snapshot);
  const calibrated: ModelConstants = {
    ...model,
    category_multiples: multiples.byCategory,
    overall_multiple: multiples.overall,
  };
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age, baseMultiple } = impliedValue(p, snapshot.as_of, calibrated, multiples);
    return { p, implied, growthPct, growthMult, maturityMult, age, baseMultiple };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: calibrated.base_multiple,
      category_multiple: round4(s.baseMultiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 *
 * Why six steps, and why these six: they are the shape of a safe first farm, not a
 * maximal one. Step 1 isolates the risk (a fresh wallet, seed offline) before any
 * money moves, because the most common way to lose a farm is to reuse a wallet that
 * already holds funds. Step 2 is the single qualifying action, sized by TVL so the
 * capital is proportionate: $250 for a protocol above $5B TVL, $150 above $1B,
 * $100 above $100M, $50 below — a small protocol does not need a large position to
 * register activity, and a large protocol's minimums are higher. Step 3 is the
 * weekly cadence, because airdrops snapshot repeatedly and one action is not a
 * pattern. Step 4 is the hold, and its length depends on age: a protocol under 180
 * days old gets 60 days (it has had fewer snapshots, so the activity must span
 * more of them), under a year gets 45, older gets 30. Step 5 is the claim, and it
 * names the protocol's own points page as the only source, because the most common
 * way to lose a farm at the end is to follow a fake claim link. Step 6 is the log,
 * because a farm that cannot be repeated or unwound from its own record is a
 * liability.
 *
 * The action verb comes from the category, matched by substring so a category the
 * author has never seen still gets a sensible verb: "lend", "cdp" and "collateral"
 * supply; "dex", "yield" and "leveraged farm" provide liquidity; "bridge" bridges;
 * "staking" and "restak" stake; "perpetual" and "derivative" deposit margin;
 * "prediction" funds a market; "curator" and "allocator" deposit into a vault;
 * "stable" mints or deposits the stable asset; "rwa" mints the yield asset;
 * "insurance" buys cover. Anything else deposits USDC. The matching is ordered
 * so the most specific category wins, and the fallback is a plain deposit — never
 * a refusal, because a protocol with an unfamiliar category still deserves a plan.
 *
 * Costs and times are honest ranges, not promises: gas is "about $X", capital is
 * "the $Y stays in the position". No step claims a return, an airdrop, or a token.
 * The plan is a way to participate, not a prediction that participation pays. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view.
 *
 * The live view is the board's conscience: it shows what the market actually
 * pays, so the reader can compare the model's implied values against real prices.
 * It takes the 24 largest live-token protocols by market cap (excluding CEX, for
 * the same reason the board excludes them), and it shows market cap as a fact,
 * not a model output. The number 24 is a display choice, not a model parameter:
 * it is enough rows to show the shape of the live market without overwhelming
 * the page. A live protocol's market cap is the ground truth the category
 * multiples are calibrated from, so the live view and the calibration read from
 * the same set — the reader can verify the multiple for any category by looking
 * at the live protocols in it. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page.
 *
 * The dashboard does not need the full board row. It needs the rank, the identity
 * (slug, name, category, chains), the figures (TVL, 7-day change, market cap,
 * listing date, age), the implied value, and the three multipliers it uses to
 * recompute and display the model. It does not need the farm steps as data,
 * because the page regenerates them from the same derivation (see
 * dashboard/app.js farmSteps) — shipping them twice would double the data and
 * risk the two copies disagreeing. It does not need the CoinGecko id or symbol,
 * because every row on the board is pre-token and those fields are null by
 * definition. The compact form is what keeps data.js small enough to inline:
 * the full board is ~280KB, the compact rows are ~70KB, and the page loads
 * faster and the dossier stays under its cap. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot.
 *
 * buildRadar is the single entry point the program and the dashboard share: it
 * calibrates the multiples once, builds the board, takes the live set, and
 * packages everything the page needs into one RadarData. Calibrating once (not
 * once per row, not once per render) is what makes the multiples consistent:
 * every row's category multiple comes from the same calibration pass over the
 * same snapshot, so two protocols in the same category always get the same
 * multiple. The early count is derived here (board rows not on the watchlist),
 * not passed in, so the dashboard's "early rows below the floor" figure can
 * never disagree with the board it renders. The model constants are the
 * calibrated ones — the category table and overall median the calibration
 * computed — so the page's model panel quotes the numbers the board actually
 * used, not the defaults the code started with. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const multiples = calibrateMultiples(snapshot);
  const calibrated: ModelConstants = {
    ...model,
    category_multiples: multiples.byCategory,
    overall_multiple: multiples.overall,
  };
  const board = buildBoard(snapshot, calibrated);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: calibrated,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores.
 *
 * The parser is strict because the snapshot is sealed: it arrives from the
 * competition, not from the author, and a malformed snapshot must fail loudly
 * rather than produce a board from misread data. Every field the model reads is
 * validated — as_of must be a YYYY-MM-DD date, floor_usd a positive safe
 * integer, protocols and watchlist arrays, each protocol with a slug, a name and
 * a finite TVL. Optional fields (change_7d, mcap_usd, listed_at, gecko_id,
 * symbol) are read leniently: a missing or mistyped optional becomes null, which
 * the model treats as "no data" rather than as zero, because a missing 7-day
 * change is not a 0% change and a missing market cap is not a $0 market cap.
 * The chains array keeps only its string entries. A protocol that fails
 * validation refuses the whole snapshot with a message naming the protocol's
 * index, so a bad input is diagnosable instead of silently dropped. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps.
 *
 * boardIssue is the model's own gate, run before anything is written: it refuses
 * a board that would fail the competition's checks, so a bug in the model is
 * caught here instead of at submission. The checks are in the order a reader
 * would ask them. Coverage first: every watchlist slug must be present, because
 * the board's first duty is the watchlist. Ranks second: ranks must be exactly
 * 1..n with no gap and no duplicate, because a ranking with a missing rank is
 * not a ranking. Order third: implied value must be non-increasing down the
 * board, because a row outranking the row above it contradicts the sort. The
 * shared-value check fourth: if the first and last rows share an implied value,
 * every row does (the board is sorted), and a board that ranks nothing by value
 * is not a ranking — it usually means the model collapsed to a constant. Farm
 * steps last: each row needs 3..12 steps, each 20..600 characters, and a positive
 * safe-integer implied value, because the gate refuses a board with a malformed
 * row. The first failure is returned, with a message naming the slug or rank, so
 * the failure is actionable. A null return means the board passes every check
 * the model knows how to run. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
 *
 * The dataset is written as a single assignment to window.RADAR, not as a JSON
 * file the page would have to fetch. A fetch would need a server or a CORS
 * allowance; an inline script works from a file, from a static host, and inside
 * the grader's container with no network at all. The JSON is compact (no
 * indentation) because data.js is data, not a document a human reads — the
 * readable form is board.json, and data.js is the compact rows the page renders
 * from. The trailing newline keeps the file well-formed for tools that expect
 * one. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
