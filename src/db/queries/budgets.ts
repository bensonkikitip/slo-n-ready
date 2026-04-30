import { getDb } from '../client';

export interface Budget {
  account_id:   string;
  category_id:  string;
  month:        string;  // 'YYYY-MM'
  amount_cents: number;  // signed (negative = expense, positive = income)
}

export async function getBudgetsForAccountYear(accountId: string, year: string): Promise<Budget[]> {
  const db = await getDb();
  return db.getAllAsync<Budget>(
    `SELECT * FROM budgets
     WHERE account_id = ? AND month >= ? AND month <= ?
     ORDER BY category_id, month`,
    accountId, `${year}-01`, `${year}-12`,
  );
}

export async function setBudget(
  accountId: string,
  categoryId: string,
  month: string,
  amountCents: number,
): Promise<void> {
  const db = await getDb();
  if (amountCents === 0) {
    await db.runAsync(
      `DELETE FROM budgets WHERE account_id = ? AND category_id = ? AND month = ?`,
      accountId, categoryId, month,
    );
  } else {
    await db.runAsync(
      `INSERT OR REPLACE INTO budgets (account_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)`,
      accountId, categoryId, month, amountCents,
    );
  }
}

export async function bulkSetBudgets(rows: Budget[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      if (r.amount_cents === 0) {
        await db.runAsync(
          `DELETE FROM budgets WHERE account_id = ? AND category_id = ? AND month = ?`,
          r.account_id, r.category_id, r.month,
        );
      } else {
        await db.runAsync(
          `INSERT OR REPLACE INTO budgets (account_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)`,
          r.account_id, r.category_id, r.month, r.amount_cents,
        );
      }
    }
  });
}

export async function replaceBudgetsForYear(
  accountId: string,
  year: string,
  rows: Budget[],
  categoryId?: string,
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    if (categoryId !== undefined) {
      await db.runAsync(
        `DELETE FROM budgets WHERE account_id = ? AND category_id = ? AND month >= ? AND month <= ?`,
        accountId, categoryId, `${year}-01`, `${year}-12`,
      );
    } else {
      await db.runAsync(
        `DELETE FROM budgets WHERE account_id = ? AND month >= ? AND month <= ?`,
        accountId, `${year}-01`, `${year}-12`,
      );
    }
    for (const r of rows) {
      if (r.amount_cents !== 0) {
        await db.runAsync(
          `INSERT INTO budgets (account_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)`,
          r.account_id, r.category_id, r.month, r.amount_cents,
        );
      }
    }
  });
}

export async function getActualsByCategoryMonth(
  accountId: string,
  year: string,
): Promise<Array<{ category_id: string; month: string; total_cents: number }>> {
  const db = await getDb();
  return db.getAllAsync<{ category_id: string; month: string; total_cents: number }>(
    `SELECT category_id, substr(date, 1, 7) AS month, SUM(amount_cents) AS total_cents
     FROM transactions
     WHERE account_id = ? AND dropped_at IS NULL AND category_id IS NOT NULL
       AND substr(date, 1, 4) = ?
     GROUP BY category_id, month`,
    accountId, year,
  );
}

// Cross-account budget rollup summed by (category, month) for a year.
export async function getBudgetsForAllAccountsYear(
  year: string,
): Promise<Array<{ category_id: string; month: string; amount_cents: number }>> {
  const db = await getDb();
  return db.getAllAsync<{ category_id: string; month: string; amount_cents: number }>(
    `SELECT category_id, month, SUM(amount_cents) AS amount_cents
     FROM budgets
     WHERE month >= ? AND month <= ?
     GROUP BY category_id, month`,
    `${year}-01`, `${year}-12`,
  );
}

// Cross-account actuals by (category, month) for a year.
export async function getActualsByCategoryMonthAllAccounts(
  year: string,
): Promise<Array<{ category_id: string; month: string; total_cents: number }>> {
  const db = await getDb();
  return db.getAllAsync<{ category_id: string; month: string; total_cents: number }>(
    `SELECT category_id, substr(date, 1, 7) AS month, SUM(amount_cents) AS total_cents
     FROM transactions
     WHERE dropped_at IS NULL AND category_id IS NOT NULL
       AND substr(date, 1, 4) = ?
     GROUP BY category_id, month`,
    year,
  );
}

// All budget rows for a year across all accounts, keyed per-account.
// Caller groups by account_id client-side to avoid N round-trips on the home screen.
export async function getBudgetsForAllAccountsYearByAccount(
  year: string,
): Promise<Budget[]> {
  const db = await getDb();
  return db.getAllAsync<Budget>(
    `SELECT * FROM budgets WHERE month >= ? AND month <= ?`,
    `${year}-01`, `${year}-12`,
  );
}

// All actuals for a year across all accounts, keyed per-account.
// Caller groups by account_id client-side to avoid N round-trips on the home screen.
export async function getActualsByCategoryMonthAllAccountsByAccount(
  year: string,
): Promise<Array<{ account_id: string; category_id: string; month: string; total_cents: number }>> {
  const db = await getDb();
  return db.getAllAsync<{ account_id: string; category_id: string; month: string; total_cents: number }>(
    `SELECT account_id, category_id, substr(date, 1, 7) AS month, SUM(amount_cents) AS total_cents
     FROM transactions
     WHERE dropped_at IS NULL AND category_id IS NOT NULL
       AND substr(date, 1, 4) = ?
     GROUP BY account_id, category_id, month`,
    year,
  );
}
