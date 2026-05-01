import {
  buildTrendRows,
  getRacheyOverallMessage,
  getRacheyCategoryMessage,
  averageSpendingPeriods,
} from '../../src/domain/trends';
import type { Category } from '../../src/db/queries/categories';

// ─── helpers ──────────────────────────────────────────────────────────────────

function cat(id: string, name: string): Category {
  return { id, name, color: '#aaa', emoji: null, description: null, exclude_from_totals: 0, created_at: 0 };
}

// ─── buildTrendRows ───────────────────────────────────────────────────────────

describe('buildTrendRows', () => {
  it('produces a row for each category that appears in either period', () => {
    const rows = buildTrendRows(
      [{ category_id: 'food', total_cents: -500 }],
      [{ category_id: 'food', total_cents: -300 }],
      [cat('food', 'Groceries')],
    );
    expect(rows).toHaveLength(1);
  });

  it('includes category only in current period — previous_cents is 0', () => {
    const rows = buildTrendRows(
      [{ category_id: 'new', total_cents: -200 }],
      [],
      [cat('new', 'New Category')],
    );
    expect(rows[0].previous_cents).toBe(0);
    expect(rows[0].current_cents).toBe(-200);
  });

  it('includes category only in previous period — current_cents is 0', () => {
    const rows = buildTrendRows(
      [],
      [{ category_id: 'old', total_cents: -300 }],
      [cat('old', 'Old Category')],
    );
    expect(rows[0].current_cents).toBe(0);
    expect(rows[0].previous_cents).toBe(-300);
  });

  it('computes delta_cents as current minus previous', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -500 }],
      [{ category_id: 'g', total_cents: -300 }],
      [cat('g', 'Groceries')],
    );
    // current −500 minus previous −300 = −200 (spent $200 more)
    expect(rows[0].delta_cents).toBe(-200);
  });

  it('delta_pct is positive when spending increases', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -600 }],
      [{ category_id: 'g', total_cents: -400 }],
      [cat('g', 'Groceries')],
    );
    expect(rows[0].delta_pct).toBeGreaterThan(0);
  });

  it('delta_pct is negative when spending decreases', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -300 }],
      [{ category_id: 'g', total_cents: -500 }],
      [cat('g', 'Groceries')],
    );
    expect(rows[0].delta_pct).toBeLessThan(0);
  });

  it('delta_pct is 0 when spending is identical', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -400 }],
      [{ category_id: 'g', total_cents: -400 }],
      [cat('g', 'Groceries')],
    );
    expect(rows[0].delta_pct).toBe(0);
  });

  it('sorts by biggest absolute delta_pct first', () => {
    const rows = buildTrendRows(
      [
        { category_id: 'a', total_cents: -110 }, // 10% up from 100
        { category_id: 'b', total_cents: -150 }, // 50% up from 100
      ],
      [
        { category_id: 'a', total_cents: -100 },
        { category_id: 'b', total_cents: -100 },
      ],
      [cat('a', 'Auto'), cat('b', 'Bills')],
    );
    expect(rows[0].category_id).toBe('b'); // bigger % change first
  });

  it('skips categories with no data in either period', () => {
    const rows = buildTrendRows(
      [],
      [],
      [cat('g', 'Groceries'), cat('e', 'Entertainment')],
    );
    expect(rows).toHaveLength(0);
  });

  it('skips data rows whose category_id is not in the categories list', () => {
    const rows = buildTrendRows(
      [{ category_id: 'deleted', total_cents: -200 }],
      [],
      [], // no matching category
    );
    expect(rows).toHaveLength(0);
  });

  it('attaches a non-empty rachey_message string to each row', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -500 }],
      [{ category_id: 'g', total_cents: -300 }],
      [cat('g', 'Groceries')],
    );
    expect(typeof rows[0].rachey_message).toBe('string');
    expect(rows[0].rachey_message.length).toBeGreaterThan(0);
  });

  it('denormalizes category_name onto each row', () => {
    const rows = buildTrendRows(
      [{ category_id: 'g', total_cents: -500 }],
      [],
      [cat('g', 'Groceries')],
    );
    expect(rows[0].category_name).toBe('Groceries');
  });
});

// ─── getRacheyOverallMessage ──────────────────────────────────────────────────

describe('getRacheyOverallMessage', () => {
  it('no-history message when previous total is 0', () => {
    const msg = getRacheyOverallMessage(-500, 0);
    expect(msg).toMatch(/Come back/i);
  });

  it('encouraging message when spending decreased', () => {
    const msg = getRacheyOverallMessage(-1500, -2000);
    expect(msg).toMatch(/less|saved|dance|\$500/i);
  });

  it('positive-framing message when spending increased', () => {
    const msg = getRacheyOverallMessage(-2500, -2000);
    expect(msg).toMatch(/Big|month|\$500/i);
  });

  it('returns a string for equal totals', () => {
    const msg = getRacheyOverallMessage(-2000, -2000);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('uses "last month" by default', () => {
    const msg = getRacheyOverallMessage(-1500, -2000);
    expect(msg).toContain('last month');
  });

  it('uses custom label for same-month-last-year comparison', () => {
    const msg = getRacheyOverallMessage(-1500, -2000, 'this month last year');
    expect(msg).toContain('this month last year');
    expect(msg).not.toContain('last month');
  });

  it('uses custom label for 3-month average comparison', () => {
    const msg = getRacheyOverallMessage(-2500, -2000, 'the 3-month average');
    expect(msg).toContain('the 3-month average');
    expect(msg).not.toContain('last month');
  });

  it('equal-totals message uses custom label', () => {
    const msg = getRacheyOverallMessage(-2000, -2000, 'this month last year');
    expect(msg).toContain('this month last year');
  });
});

// ─── getRacheyCategoryMessage ─────────────────────────────────────────────────

describe('getRacheyCategoryMessage', () => {
  it('food + big increase (>20%) → delicious', () => {
    const msg = getRacheyCategoryMessage('Groceries', 0.25);
    expect(msg).toMatch(/delicious|🍕/i);
  });

  it('food + small increase → tasty fallback (not delicious)', () => {
    const msg = getRacheyCategoryMessage('Groceries', 0.10);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('food + decrease → cooking smart', () => {
    const msg = getRacheyCategoryMessage('Groceries', -0.15);
    expect(msg).toMatch(/cook|smart|🥗/i);
  });

  it('entertainment + increase → fun message', () => {
    const msg = getRacheyCategoryMessage('Entertainment', 0.10);
    expect(msg).toMatch(/fun|deserve|🎉/i);
  });

  it('entertainment + decrease → quiet month', () => {
    const msg = getRacheyCategoryMessage('Entertainment', -0.10);
    expect(msg).toMatch(/quiet|saving|🎟️/i);
  });

  it('shopping + increase → retail therapy', () => {
    const msg = getRacheyCategoryMessage('Shopping', 0.10);
    expect(msg).toMatch(/retail|therapy|🛍️/i);
  });

  it('shopping + big decrease → not buying things', () => {
    const msg = getRacheyCategoryMessage('Shopping', -0.35);
    expect(msg).toMatch(/buying|💪/i);
  });

  it('any category + <5% change → consistency machine', () => {
    const msg = getRacheyCategoryMessage('Utilities', 0.03);
    expect(msg).toMatch(/consistent|machine|🤖/i);
  });

  it('any category + big decrease (>30%) → real progress', () => {
    const msg = getRacheyCategoryMessage('Utilities', -0.35);
    expect(msg).toMatch(/progress|📉/i);
  });

  it('any category + big increase (>30%) → life happening', () => {
    const msg = getRacheyCategoryMessage('Utilities', 0.35);
    expect(msg).toMatch(/life|happening|✨/i);
  });

  it('fallback + small decrease → trending direction', () => {
    const msg = getRacheyCategoryMessage('Miscellaneous', -0.10);
    expect(msg).toMatch(/trend|direction|🌱/i);
  });

  it('fallback + small increase → returns a non-empty string', () => {
    const msg = getRacheyCategoryMessage('Miscellaneous', 0.10);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('transport keyword match — up → movement', () => {
    const msg = getRacheyCategoryMessage('Transport & Gas', 0.10);
    expect(msg).toMatch(/movement|town|🚗/i);
  });

  it('health keyword match — up → investing in yourself', () => {
    const msg = getRacheyCategoryMessage('Health & Gym', 0.10);
    expect(msg).toMatch(/invest|yourself|💪/i);
  });
});

// ─── averageSpendingPeriods ───────────────────────────────────────────────────

describe('averageSpendingPeriods', () => {
  it('averages cents across multiple periods for one category', () => {
    const periods = [
      [{ category_id: 'g', total_cents: -300 }],
      [{ category_id: 'g', total_cents: -600 }],
      [{ category_id: 'g', total_cents: -900 }],
    ];
    const result = averageSpendingPeriods(periods);
    expect(result).toHaveLength(1);
    expect(result[0].total_cents).toBeCloseTo(-600);
  });

  it('treats missing periods as 0 for that category', () => {
    const periods = [
      [{ category_id: 'a', total_cents: -300 }],
      [{ category_id: 'a', total_cents: -300 }, { category_id: 'b', total_cents: -600 }],
    ];
    const result = averageSpendingPeriods(periods);
    const a = result.find(r => r.category_id === 'a');
    const b = result.find(r => r.category_id === 'b');
    expect(a?.total_cents).toBeCloseTo(-300);  // (−300 + −300) / 2
    expect(b?.total_cents).toBeCloseTo(-300);  // (0 + −600) / 2
  });

  it('returns empty array for empty input', () => {
    expect(averageSpendingPeriods([])).toEqual([]);
  });

  it('handles a single period (no averaging needed)', () => {
    const result = averageSpendingPeriods([[{ category_id: 'g', total_cents: -400 }]]);
    expect(result[0].total_cents).toBeCloseTo(-400);
  });
});
