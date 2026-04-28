import {
  buildCategoryRows,
  computeVarianceSummary,
  classifyRow,
  computeProgress,
  sortCategoryRows,
  CategoryRow,
} from '../../src/domain/budget-variance';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CategoryRow> & { category_id: string }): CategoryRow {
  return {
    budget_cents: 0,
    actual_cents: 0,
    has_budget:   false,
    has_actual:   false,
    ...overrides,
  };
}

const MONTHS_JAN = ['2026-01'];
const MONTHS_YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

// ─── buildCategoryRows ────────────────────────────────────────────────────────

describe('buildCategoryRows', () => {
  it('aggregates budget and actual for the same category', () => {
    const rows = buildCategoryRows(
      [{ category_id: 'g', month: '2026-01', amount_cents: -500 }],
      [{ category_id: 'g', month: '2026-01', total_cents:  -340 }],
      MONTHS_JAN,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ budget_cents: -500, actual_cents: -340, has_budget: true, has_actual: true });
  });

  it('includes categories with budget only', () => {
    const rows = buildCategoryRows(
      [{ category_id: 'g', month: '2026-01', amount_cents: -500 }],
      [],
      MONTHS_JAN,
    );
    expect(rows[0]).toMatchObject({ budget_cents: -500, actual_cents: 0, has_budget: true, has_actual: false });
  });

  it('includes categories with actual only', () => {
    const rows = buildCategoryRows(
      [],
      [{ category_id: 'g', month: '2026-01', total_cents: -200 }],
      MONTHS_JAN,
    );
    expect(rows[0]).toMatchObject({ budget_cents: 0, actual_cents: -200, has_budget: false, has_actual: true });
  });

  it('filters out months outside the range', () => {
    const rows = buildCategoryRows(
      [{ category_id: 'g', month: '2026-02', amount_cents: -500 }],
      [],
      MONTHS_JAN, // only Jan
    );
    expect(rows).toHaveLength(0);
  });

  it('sums multiple months in year mode', () => {
    const rows = buildCategoryRows(
      [
        { category_id: 'g', month: '2026-01', amount_cents: -500 },
        { category_id: 'g', month: '2026-02', amount_cents: -500 },
      ],
      [
        { category_id: 'g', month: '2026-01', total_cents: -400 },
        { category_id: 'g', month: '2026-03', total_cents: -300 },
      ],
      MONTHS_YEAR,
    );
    expect(rows[0].budget_cents).toBe(-1000);
    expect(rows[0].actual_cents).toBe(-700);
  });

  it('produces one row per distinct category', () => {
    const rows = buildCategoryRows(
      [
        { category_id: 'g', month: '2026-01', amount_cents: -500 },
        { category_id: 'd', month: '2026-01', amount_cents: -150 },
      ],
      [
        { category_id: 's', month: '2026-01', total_cents: 5000 },
      ],
      MONTHS_JAN,
    );
    expect(rows).toHaveLength(3);
  });

  it('month-mode and year-mode produce the same result for single-month data', () => {
    const budget = [{ category_id: 'g', month: '2026-03', amount_cents: -500 }];
    const actual = [{ category_id: 'g', month: '2026-03', total_cents: -340 }];
    const rowsMonth = buildCategoryRows(budget, actual, ['2026-03']);
    const rowsYear  = buildCategoryRows(budget, actual, MONTHS_YEAR);
    expect(rowsMonth[0].budget_cents).toBe(rowsYear[0].budget_cents);
    expect(rowsMonth[0].actual_cents).toBe(rowsYear[0].actual_cents);
  });
});

// ─── computeVarianceSummary ───────────────────────────────────────────────────

describe('computeVarianceSummary', () => {
  it('pure expense: sums expense side only', () => {
    const rows = [makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -340, has_budget: true, has_actual: true })];
    const s = computeVarianceSummary(rows);
    expect(s.expense_budget_cents).toBe(-500);
    expect(s.expense_actual_cents).toBe(-340);
    expect(s.expense_variance_cents).toBe(160);  // under-spent
    expect(s.income_budget_cents).toBe(0);
    expect(s.income_actual_cents).toBe(0);
    expect(s.income_variance_cents).toBe(0);
  });

  it('pure income: sums income side only', () => {
    const rows = [makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 5200, has_budget: true, has_actual: true })];
    const s = computeVarianceSummary(rows);
    expect(s.income_budget_cents).toBe(5000);
    expect(s.income_actual_cents).toBe(5200);
    expect(s.income_variance_cents).toBe(200);   // over goal
    expect(s.expense_budget_cents).toBe(0);
  });

  it('mixed: splits correctly', () => {
    const rows = [
      makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 4800, has_budget: true }),
      makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -600, has_budget: true }),
    ];
    const s = computeVarianceSummary(rows);
    expect(s.income_budget_cents).toBe(5000);
    expect(s.income_variance_cents).toBe(-200);  // under goal
    expect(s.expense_budget_cents).toBe(-500);
    expect(s.expense_variance_cents).toBe(-100); // over-spent
  });

  it('no-budget rows follow actual sign for income/expense split', () => {
    const rows = [
      makeRow({ category_id: 'a', actual_cents: 1000, has_actual: true }), // income-side (actual > 0)
      makeRow({ category_id: 'b', actual_cents: -200, has_actual: true }), // expense-side
    ];
    const s = computeVarianceSummary(rows);
    expect(s.income_actual_cents).toBe(1000);
    expect(s.expense_actual_cents).toBe(-200);
  });

  it('empty rows returns all zeros', () => {
    const s = computeVarianceSummary([]);
    expect(s).toMatchObject({
      income_budget_cents: 0, income_actual_cents: 0, income_variance_cents: 0,
      expense_budget_cents: 0, expense_actual_cents: 0, expense_variance_cents: 0,
    });
  });
});

// ─── classifyRow ─────────────────────────────────────────────────────────────

describe('classifyRow', () => {
  it('no budget → neutral', () => {
    expect(classifyRow(makeRow({ category_id: 'g', actual_cents: -200 }))).toBe('neutral');
  });

  it('zero budget → neutral', () => {
    const row = makeRow({ category_id: 'g', budget_cents: 0, has_budget: true });
    expect(classifyRow(row)).toBe('neutral');
  });

  it('expense under-budget → good', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -340, has_budget: true });
    expect(classifyRow(row)).toBe('good');
  });

  it('expense exactly on-budget → good', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -500, has_budget: true });
    expect(classifyRow(row)).toBe('good');
  });

  it('expense over-budget → bad', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -640, has_budget: true });
    expect(classifyRow(row)).toBe('bad');
  });

  it('income over goal → good', () => {
    const row = makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 5200, has_budget: true });
    expect(classifyRow(row)).toBe('good');
  });

  it('income exactly on goal → good', () => {
    const row = makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 5000, has_budget: true });
    expect(classifyRow(row)).toBe('good');
  });

  it('income under goal → bad', () => {
    const row = makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 4600, has_budget: true });
    expect(classifyRow(row)).toBe('bad');
  });

  it('budget set but no actuals → good (zero spend = under budget)', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: 0, has_budget: true });
    expect(classifyRow(row)).toBe('good');
  });
});

// ─── computeProgress ─────────────────────────────────────────────────────────

describe('computeProgress', () => {
  it('no budget → 0', () => {
    expect(computeProgress(makeRow({ category_id: 'g', actual_cents: -200 }))).toBe(0);
  });

  it('zero budget → 0', () => {
    const row = makeRow({ category_id: 'g', budget_cents: 0, has_budget: true });
    expect(computeProgress(row)).toBe(0);
  });

  it('68% spend → 0.68', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -340, has_budget: true });
    expect(computeProgress(row)).toBeCloseTo(0.68);
  });

  it('100% spend → 1.0', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -500, has_budget: true });
    expect(computeProgress(row)).toBe(1.0);
  });

  it('150% spend → capped at 1.5', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -750, has_budget: true });
    expect(computeProgress(row)).toBe(1.5);
  });

  it('200% spend → capped at 1.5', () => {
    const row = makeRow({ category_id: 'g', budget_cents: -500, actual_cents: -1000, has_budget: true });
    expect(computeProgress(row)).toBe(1.5);
  });

  it('income: partial progress reads correctly', () => {
    const row = makeRow({ category_id: 's', budget_cents: 5000, actual_cents: 2500, has_budget: true });
    expect(computeProgress(row)).toBe(0.5);
  });
});

// ─── sortCategoryRows ─────────────────────────────────────────────────────────

describe('sortCategoryRows', () => {
  const name = (id: string) => id; // alphabetical by id for tests

  it('budgeted rows come before unbudgeted rows', () => {
    const rows = [
      makeRow({ category_id: 'a', actual_cents: -200, has_actual: true }),
      makeRow({ category_id: 'b', budget_cents: -500, has_budget: true }),
    ];
    const sorted = sortCategoryRows(rows, name);
    expect(sorted[0].category_id).toBe('b'); // budgeted first
  });

  it('income before expense within the same budget group', () => {
    const rows = [
      makeRow({ category_id: 'g', budget_cents: -500, has_budget: true }),
      makeRow({ category_id: 's', budget_cents: 5000, has_budget: true }),
    ];
    const sorted = sortCategoryRows(rows, name);
    expect(sorted[0].category_id).toBe('s'); // income first
  });

  it('higher absolute budget value sorts first within same group', () => {
    const rows = [
      makeRow({ category_id: 'd', budget_cents: -100, has_budget: true }),
      makeRow({ category_id: 'g', budget_cents: -500, has_budget: true }),
    ];
    const sorted = sortCategoryRows(rows, name);
    expect(sorted[0].category_id).toBe('g'); // |500| > |100|
  });

  it('unbudgeted: income before expense', () => {
    const rows = [
      makeRow({ category_id: 'x', actual_cents: -200, has_actual: true }),
      makeRow({ category_id: 'y', actual_cents: 1000, has_actual: true }),
    ];
    const sorted = sortCategoryRows(rows, name);
    expect(sorted[0].category_id).toBe('y'); // income (actual > 0) first
  });

  it('alphabetical tiebreaker', () => {
    const rows = [
      makeRow({ category_id: 'z', budget_cents: -500, has_budget: true }),
      makeRow({ category_id: 'a', budget_cents: -500, has_budget: true }),
    ];
    const sorted = sortCategoryRows(rows, name);
    expect(sorted[0].category_id).toBe('a');
  });

  it('does not mutate the original array', () => {
    const rows = [
      makeRow({ category_id: 'b', budget_cents: -500, has_budget: true }),
      makeRow({ category_id: 'a', budget_cents: -500, has_budget: true }),
    ];
    sortCategoryRows(rows, name);
    expect(rows[0].category_id).toBe('b'); // unchanged
  });
});
