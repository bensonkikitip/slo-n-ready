export interface CategoryRow {
  category_id:  string;
  budget_cents: number;  // signed; 0 if no budget set
  actual_cents: number;  // signed; 0 if no transactions
  has_budget:   boolean; // true if any budget row exists for this category in the period
  has_actual:   boolean; // true if any transactions exist for this category in the period
}

export interface VarianceSummary {
  income_budget_cents:    number;
  income_actual_cents:    number;
  income_variance_cents:  number; // actual - budget; positive = over goal (good)
  expense_budget_cents:   number; // negative
  expense_actual_cents:   number; // negative
  expense_variance_cents: number; // actual - budget; positive = under-spent (good)
}

export type Track = 'good' | 'bad' | 'neutral';

// Builds one CategoryRow per category that appears in either budgets or actuals
// for the given monthsInRange. Missing side treated as 0.
export function buildCategoryRows(
  budgetRows: Array<{ category_id: string; month: string; amount_cents: number }>,
  actualRows: Array<{ category_id: string; month: string; total_cents: number }>,
  monthsInRange: string[],
): CategoryRow[] {
  const rangeSet = new Set(monthsInRange);

  const budgetByCat = new Map<string, number>();
  const hasBudget   = new Set<string>();
  for (const r of budgetRows) {
    if (!rangeSet.has(r.month)) continue;
    budgetByCat.set(r.category_id, (budgetByCat.get(r.category_id) ?? 0) + r.amount_cents);
    hasBudget.add(r.category_id);
  }

  const actualByCat = new Map<string, number>();
  const hasActual   = new Set<string>();
  for (const r of actualRows) {
    if (!rangeSet.has(r.month)) continue;
    actualByCat.set(r.category_id, (actualByCat.get(r.category_id) ?? 0) + r.total_cents);
    hasActual.add(r.category_id);
  }

  const allCats = new Set([...budgetByCat.keys(), ...actualByCat.keys()]);
  const rows: CategoryRow[] = [];
  for (const cat of allCats) {
    rows.push({
      category_id:  cat,
      budget_cents: budgetByCat.get(cat) ?? 0,
      actual_cents: actualByCat.get(cat) ?? 0,
      has_budget:   hasBudget.has(cat),
      has_actual:   hasActual.has(cat),
    });
  }
  return rows;
}

// Splits rows into income (budget > 0 or, if no budget, actual > 0) and expense
// halves, then sums each half's budget, actual, and variance.
export function computeVarianceSummary(rows: CategoryRow[]): VarianceSummary {
  let incomeBudget = 0, incomeActual = 0;
  let expenseBudget = 0, expenseActual = 0;

  for (const r of rows) {
    const isIncome = r.has_budget ? r.budget_cents > 0 : r.actual_cents > 0;
    if (isIncome) {
      incomeBudget += r.budget_cents;
      incomeActual += r.actual_cents;
    } else {
      expenseBudget += r.budget_cents;
      expenseActual += r.actual_cents;
    }
  }

  return {
    income_budget_cents:    incomeBudget,
    income_actual_cents:    incomeActual,
    income_variance_cents:  incomeActual - incomeBudget,
    expense_budget_cents:   expenseBudget,
    expense_actual_cents:   expenseActual,
    expense_variance_cents: expenseActual - expenseBudget,
  };
}

// Returns 'good', 'bad', or 'neutral' based on the sign-of-budget convention:
//   - no budget → neutral
//   - expense (budget < 0): actual less negative than budget → good (under-spent)
//   - income  (budget > 0): actual more positive than budget → good (over goal)
//   - zero budget with actual (mixed edge) → neutral
export function classifyRow(row: CategoryRow): Track {
  if (!row.has_budget) return 'neutral';
  if (row.budget_cents === 0) return 'neutral';
  const variance = row.actual_cents - row.budget_cents;
  const isIncome = row.budget_cents > 0;
  if (isIncome) {
    return variance >= 0 ? 'good' : 'bad';
  } else {
    // expense: positive variance = actual is less negative = under-spent = good
    return variance >= 0 ? 'good' : 'bad';
  }
}

// Returns a fill ratio in [0, 1.5].
//   0 when no budget set. 1.0 = exactly on budget. > 1 = over budget.
//   Capped at 1.5 so the bar doesn't overflow its container.
export function computeProgress(row: CategoryRow): number {
  if (!row.has_budget || row.budget_cents === 0) return 0;
  const ratio = Math.abs(row.actual_cents) / Math.abs(row.budget_cents);
  return Math.min(ratio, 1.5);
}

// Sorts rows: budgeted rows first (|budget| desc), then unbudgeted (|actual| desc).
// Within each group, income before expense.
export function sortCategoryRows(
  rows: CategoryRow[],
  categoryName: (id: string) => string,
): CategoryRow[] {
  return [...rows].sort((a, b) => {
    const aBudgeted = a.has_budget ? 1 : 0;
    const bBudgeted = b.has_budget ? 1 : 0;
    if (aBudgeted !== bBudgeted) return bBudgeted - aBudgeted;

    // Within same budget group: income before expense
    const aIncome = a.has_budget ? (a.budget_cents > 0 ? 1 : 0) : (a.actual_cents > 0 ? 1 : 0);
    const bIncome = b.has_budget ? (b.budget_cents > 0 ? 1 : 0) : (b.actual_cents > 0 ? 1 : 0);
    if (aIncome !== bIncome) return bIncome - aIncome;

    // Within same income/expense group: higher absolute value first
    const aMag = Math.abs(a.has_budget ? a.budget_cents : a.actual_cents);
    const bMag = Math.abs(b.has_budget ? b.budget_cents : b.actual_cents);
    if (bMag !== aMag) return bMag - aMag;

    // Alphabetical tiebreaker
    return categoryName(a.category_id).localeCompare(categoryName(b.category_id));
  });
}
