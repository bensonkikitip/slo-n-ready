/**
 * Trends domain module — spending comparison logic and Rachey message library.
 *
 * Terminology note (v4.4.0):
 *   UI says "spending goal"  →  DB table is still `budgets` (no migration risk).
 *   "Targets" is reserved for a future goal-setting feature.
 */

import type { Category } from '../db/queries/categories';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendRow {
  category_id:    string;
  category_name:  string;  // denormalized for convenience in components
  current_cents:  number;  // signed; negative = expense, positive = income
  previous_cents: number;
  delta_cents:    number;  // current_cents − previous_cents
  /**
   * Positive = spent more (|current| > |previous|).
   * Negative = spent less.
   * 0 when identical; ±1 when only one period has data.
   */
  delta_pct:      number;
  rachey_message: string;  // one-liner from the message library
}

// ─── buildTrendRows ───────────────────────────────────────────────────────────

/**
 * Merges two period spending arrays into comparison rows, one per category.
 * Categories with no data in either period are excluded.
 * Categories present in data but missing from `categories` are skipped
 * (e.g., deleted categories).
 * Sorted: biggest absolute delta_pct first.
 */
export function buildTrendRows(
  current:    Array<{ category_id: string; total_cents: number }>,
  previous:   Array<{ category_id: string; total_cents: number }>,
  categories: Category[],
): TrendRow[] {
  const currentMap  = new Map(current.map(r  => [r.category_id, r.total_cents]));
  const previousMap = new Map(previous.map(r => [r.category_id, r.total_cents]));
  const catMap      = new Map(categories.map(c => [c.id, c]));

  // Union of all category IDs that appear in either period
  const allIds = new Set([...currentMap.keys(), ...previousMap.keys()]);

  const rows: TrendRow[] = [];
  for (const id of allIds) {
    const cat = catMap.get(id);
    if (!cat) continue; // category deleted — skip

    const cur  = currentMap.get(id)  ?? 0;
    const prev = previousMap.get(id) ?? 0;

    const delta_cents = cur - prev;

    // delta_pct: positive = more absolute spending, negative = less.
    // (|cur| − |prev|) / |prev|  works consistently for both expense and income rows.
    const absCur  = Math.abs(cur);
    const absPrev = Math.abs(prev);
    const delta_pct = absPrev !== 0
      ? (absCur - absPrev) / absPrev
      : (cur !== 0 ? 1 : 0); // 100% change if category is brand-new this period

    rows.push({
      category_id:    id,
      category_name:  cat.name,
      current_cents:  cur,
      previous_cents: prev,
      delta_cents,
      delta_pct,
      rachey_message: getRacheyCategoryMessage(cat.name, delta_pct),
    });
  }

  // Sort: biggest absolute delta_pct first (most-changed is most interesting)
  rows.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

  return rows;
}

// ─── getRacheyOverallMessage ──────────────────────────────────────────────────

/**
 * Returns Rachey's overall summary for the period comparison.
 *
 * @param totalCurrentCents  Sum of expense amounts for the current period (typically negative).
 * @param totalPreviousCents Sum of expense amounts for the comparison period.
 * @param comparisonLabel    Human-readable label for the comparison period,
 *                           e.g. "last month", "this month last year", "the 3-month average".
 *                           Defaults to "last month" for backwards compatibility.
 */
export function getRacheyOverallMessage(
  totalCurrentCents:  number,
  totalPreviousCents: number,
  comparisonLabel = 'last month',
): string {
  if (totalPreviousCents === 0) {
    return "Come back after one more month and I'll show you how you're trending 📖";
  }

  const curAbs  = Math.abs(totalCurrentCents);
  const prevAbs = Math.abs(totalPreviousCents);
  const diffAbs = Math.abs(curAbs - prevAbs);
  const dollars = Math.round(diffAbs / 100);

  if (curAbs < prevAbs) {
    return `You spent $${dollars} less than ${comparisonLabel} — Rachey is doing a happy dance! 💃`;
  }
  if (curAbs > prevAbs) {
    return `Big month! Spending was up $${dollars} from ${comparisonLabel} — let's see where it went 🔍`;
  }
  return `Spending was exactly the same as ${comparisonLabel} — steady as ever! 😄`;
}

// ─── getRacheyCategoryMessage ─────────────────────────────────────────────────

// Thresholds
const SAME_THRESHOLD      = 0.05; // < 5% either direction = "same"
const FOOD_BIG_THRESHOLD  = 0.20; // > 20% increase on food = "delicious month"
const BIG_THRESHOLD       = 0.30; // > 30% generic big change

/**
 * Returns a one-line Rachey micro-comment for a category's spending change.
 *
 * @param categoryName  The category's display name (case-insensitive matching).
 * @param deltaPct      Positive = spent more, negative = spent less.
 */
export function getRacheyCategoryMessage(
  categoryName: string,
  deltaPct:     number,
): string {
  const name  = categoryName.toLowerCase();
  const isUp  = deltaPct > 0;
  const isBig = Math.abs(deltaPct) > BIG_THRESHOLD;

  // "Same" bucket — check before any direction-specific logic
  if (Math.abs(deltaPct) < SAME_THRESHOLD) {
    return "Incredibly consistent here — you're a machine 🤖";
  }

  // ── Category-specific rules ───────────────────────────────────────────────

  if (isFood(name)) {
    if (isUp && deltaPct > FOOD_BIG_THRESHOLD) return "Wow, what a delicious month! 🍕";
    if (isUp)                                  return "A tasty month! Treating yourself is allowed 🍜";
    return "You've been cooking smart this month 🥗";
  }

  // Transport checked before Entertainment — "transport" contains "sport" as a substring.
  if (isTransport(name)) {
    if (isUp)  return "Getting around town! Life is movement 🚗";
    return "Staying close to home this month 🏡";
  }

  if (isHealth(name)) {
    if (isUp) return "Investing in yourself — the best investment 💪";
    return "Resting up? Sometimes that's the best medicine 😴";
  }

  if (isEntertainment(name)) {
    if (isUp)  return "You had SO much fun! No shame — you deserve it 🎉";
    return "Quiet month? Saving up for something big? 🎟️";
  }

  if (isShopping(name)) {
    if (!isUp && isBig) return "Look at you, not buying things you don't need 💪";
    if (isUp)           return "A little retail therapy never hurt anyone 🛍️";
    return "Keeping those shopping urges in check 👍";
  }

  // ── Generic magnitude rules ───────────────────────────────────────────────

  if (!isUp && isBig) {
    const pct = Math.round(Math.abs(deltaPct) * 100);
    return `Down ${pct}% — that's real progress! 📉✨`;
  }
  if (isUp && isBig) return "Big month in this area — life is happening ✨";
  if (!isUp)         return "Trending in the right direction! 🌱";
  return "A little more here this month";
}

// ─── Category keyword matchers ────────────────────────────────────────────────

function isFood(name: string): boolean {
  return ['food', 'grocer', 'restaurant', 'dining', 'eat', 'cafe',
          'coffee', 'lunch', 'dinner', 'breakfast', 'meal'].some(k => name.includes(k));
}

function isEntertainment(name: string): boolean {
  return ['entertainment', 'fun', 'movie', 'music', 'game',
          'sport', 'concert', 'streaming', 'hobby'].some(k => name.includes(k));
}

function isShopping(name: string): boolean {
  return ['shop', 'cloth', 'apparel', 'retail', 'amazon', 'purchase'].some(k => name.includes(k));
}

function isTransport(name: string): boolean {
  return ['transport', 'gas', 'fuel', 'lyft', 'uber', 'car',
          'auto', 'commut', 'transit', 'parking', 'travel'].some(k => name.includes(k));
}

function isHealth(name: string): boolean {
  return ['health', 'gym', 'fitness', 'medical', 'doctor',
          'dental', 'pharmacy', 'wellness'].some(k => name.includes(k));
}

// ─── averageSpendingPeriods ───────────────────────────────────────────────────

/**
 * Averages multiple period spending arrays into one, for the
 * "vs 3-month average" comparison mode.
 * Categories absent from a period are treated as 0 for that period.
 */
export function averageSpendingPeriods(
  periods: Array<Array<{ category_id: string; total_cents: number }>>,
): Array<{ category_id: string; total_cents: number }> {
  if (periods.length === 0) return [];

  const n      = periods.length;
  const totals = new Map<string, number>();

  for (const period of periods) {
    for (const row of period) {
      totals.set(row.category_id, (totals.get(row.category_id) ?? 0) + row.total_cents);
    }
  }

  return Array.from(totals.entries()).map(([category_id, sum]) => ({
    category_id,
    total_cents: Math.round(sum / n), // keep cents as integers; centsToDollars expects ints
  }));
}
