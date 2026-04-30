import { getDb } from '../client';

export interface ImportBatch {
  id: string;
  account_id: string;
  filename: string | null;
  imported_at: number;
  rows_total: number;
  rows_inserted: number;
  rows_skipped_duplicate: number;
  rows_cleared: number;
  rows_dropped: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  amount_cents: number;
  description: string;
  original_description: string;
  is_pending: number;
  dropped_at: number | null;
  import_batch_id: string;
  created_at: number;
  category_id: string | null;
  category_set_manually: number;
  applied_rule_id: string | null;
}

export interface AccountSummary {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  transaction_count: number;
  last_imported_at: number | null;
}

export interface ParsedRow {
  id: string;
  date: string;
  amount_cents: number;
  description: string;
  original_description: string;
  is_pending: boolean;
}

export interface ImportResult {
  inserted: number;   // brand-new transactions added
  cleared: number;    // previously-pending transactions that are now cleared
  dropped: number;    // pending transactions that disappeared from the bank's feed
  skipped: number;    // exact duplicates already in DB (no change needed)
  total: number;      // rows in the CSV file
}

// Summary queries exclude dropped transactions so they don't inflate/deflate totals.
// Pending transactions ARE included — they represent real expected charges.
const ACTIVE_FILTER = `dropped_at IS NULL`;

function catClause(ids: string[]): { sql: string; params: string[] } {
  if (ids.length === 0) return { sql: '', params: [] };
  return {
    sql: ` AND category_id IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}

// --- Import batches ---

export async function updateImportBatchCounts(
  id: string,
  counts: { rows_inserted: number; rows_skipped_duplicate: number; rows_cleared: number; rows_dropped: number },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE import_batches
       SET rows_inserted = ?, rows_skipped_duplicate = ?, rows_cleared = ?, rows_dropped = ?
     WHERE id = ?`,
    counts.rows_inserted, counts.rows_skipped_duplicate, counts.rows_cleared, counts.rows_dropped, id,
  );
}

export async function insertImportBatch(batch: ImportBatch): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO import_batches
       (id, account_id, filename, imported_at, rows_total, rows_inserted,
        rows_skipped_duplicate, rows_cleared, rows_dropped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    batch.id,
    batch.account_id,
    batch.filename ?? null,
    batch.imported_at,
    batch.rows_total,
    batch.rows_inserted,
    batch.rows_skipped_duplicate,
    batch.rows_cleared,
    batch.rows_dropped,
  );
}

// --- Import flow ---

export async function importTransactions(
  accountId: string,
  batchId: string,
  rows: ParsedRow[],
): Promise<ImportResult> {
  const db = await getDb();
  let inserted = 0;
  let cleared = 0;
  let dropped = 0;
  const now = Date.now();
  const importedIds = new Set(rows.map((r) => r.id));

  await db.withTransactionAsync(async () => {
    // --- Pass 1a: find which incoming IDs already exist ---
    const existingIds = new Set<string>();
    const ID_LOOKUP_CHUNK = 500;
    for (let i = 0; i < rows.length; i += ID_LOOKUP_CHUNK) {
      const chunk = rows.slice(i, i + ID_LOOKUP_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const found = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM transactions WHERE account_id = ? AND id IN (${placeholders})`,
        accountId, ...chunk.map(r => r.id),
      );
      for (const r of found) existingIds.add(r.id);
    }

    // --- Pass 1b: bulk INSERT OR IGNORE the new rows ---
    // 10 cols × 75 rows = 750 params, under SQLite's 999-variable limit
    const newRows = rows.filter(r => !existingIds.has(r.id));
    inserted = newRows.length;
    const INSERT_CHUNK = 75;
    const newRowCols = '(?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)';
    for (let i = 0; i < newRows.length; i += INSERT_CHUNK) {
      const chunk = newRows.slice(i, i + INSERT_CHUNK);
      const placeholders = chunk.map(() => newRowCols).join(', ');
      const params = chunk.flatMap(r => [
        r.id, accountId, r.date, r.amount_cents, r.description, r.original_description,
        r.is_pending ? 1 : 0, batchId, now,
      ]);
      await db.runAsync(
        `INSERT OR IGNORE INTO transactions
           (id, account_id, date, amount_cents, description, original_description,
            is_pending, dropped_at, import_batch_id, created_at)
         VALUES ${placeholders}`,
        ...params,
      );
    }

    // --- Pass 1c: bulk-clear existing rows whose new copy isn't pending ---
    const clearCandidateIds = rows
      .filter(r => existingIds.has(r.id) && !r.is_pending)
      .map(r => r.id);
    const CLEAR_CHUNK = 500;
    for (let i = 0; i < clearCandidateIds.length; i += CLEAR_CHUNK) {
      const chunk = clearCandidateIds.slice(i, i + CLEAR_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await db.runAsync(
        `UPDATE transactions SET is_pending = 0
         WHERE id IN (${placeholders}) AND is_pending = 1 AND dropped_at IS NULL`,
        ...chunk,
      );
      cleared += result.changes ?? 0;
    }

    // --- Pass 2: detect dropped pendings ---
    // A pending transaction is "dropped" when the bank's export covers its date
    // but doesn't include it anymore (as either pending or cleared). We use the
    // date range of this import as the coverage window.
    if (rows.length > 0) {
      const dates = rows.map((r) => r.date).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      const pendingInRange = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM transactions
         WHERE account_id = ? AND is_pending = 1 AND dropped_at IS NULL
           AND date >= ? AND date <= ?`,
        accountId, minDate, maxDate,
      );

      const droppedIds = pendingInRange.filter(p => !importedIds.has(p.id)).map(p => p.id);
      const DROP_CHUNK = 500;
      for (let i = 0; i < droppedIds.length; i += DROP_CHUNK) {
        const chunk = droppedIds.slice(i, i + DROP_CHUNK);
        const placeholders = chunk.map(() => '?').join(', ');
        const result = await db.runAsync(
          `UPDATE transactions SET dropped_at = ? WHERE id IN (${placeholders})`,
          now, ...chunk,
        );
        dropped += result.changes ?? 0;
      }
    }
  });

  const skipped = rows.length - inserted - cleared;
  return { inserted, cleared, dropped, skipped, total: rows.length };
}

// --- Listing ---

export async function getTransactions(accountId: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE account_id = ? ORDER BY date DESC, created_at DESC`,
    accountId,
  );
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions ORDER BY date DESC, created_at DESC`,
  );
}

export async function getAccountSummary(accountId: string): Promise<AccountSummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    income_cents: number;
    expense_cents: number;
    net_cents: number;
    transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions WHERE account_id = ? AND ${ACTIVE_FILTER}`,
    accountId,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches WHERE account_id = ? ORDER BY imported_at DESC LIMIT 1`,
    accountId,
  );
  return {
    income_cents: row?.income_cents ?? 0,
    expense_cents: row?.expense_cents ?? 0,
    net_cents: row?.net_cents ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at: lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummary(): Promise<AccountSummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    income_cents: number;
    expense_cents: number;
    net_cents: number;
    transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions WHERE ${ACTIVE_FILTER}`,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents: row?.income_cents ?? 0,
    expense_cents: row?.expense_cents ?? 0,
    net_cents: row?.net_cents ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at: lastBatch?.imported_at ?? null,
  };
}

// --- Month-filtered queries ---

export async function getDistinctYears(accountId?: string): Promise<Array<{ year: string; count: number }>> {
  const db = await getDb();
  if (accountId) {
    return db.getAllAsync<{ year: string; count: number }>(
      `SELECT substr(date, 1, 4) AS year, COUNT(*) AS count
       FROM transactions
       WHERE account_id = ? AND dropped_at IS NULL
       GROUP BY year ORDER BY year DESC`,
      accountId,
    );
  }
  return db.getAllAsync<{ year: string; count: number }>(
    `SELECT substr(date, 1, 4) AS year, COUNT(*) AS count
     FROM transactions
     WHERE dropped_at IS NULL
     GROUP BY year ORDER BY year DESC`,
  );
}

export async function getDistinctMonths(accountId?: string): Promise<Array<{ month: string; count: number }>> {
  const db = await getDb();
  if (accountId) {
    return db.getAllAsync<{ month: string; count: number }>(
      `SELECT substr(date, 1, 7) AS month, COUNT(*) AS count
       FROM transactions
       WHERE account_id = ? AND dropped_at IS NULL
       GROUP BY month ORDER BY month DESC`,
      accountId,
    );
  }
  return db.getAllAsync<{ month: string; count: number }>(
    `SELECT substr(date, 1, 7) AS month, COUNT(*) AS count
     FROM transactions
     WHERE dropped_at IS NULL
     GROUP BY month ORDER BY month DESC`,
  );
}

export async function getTransactionsForMonth(accountId: string, month: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE account_id = ? AND substr(date, 1, 7) = ?
     ORDER BY date DESC, created_at DESC`,
    accountId, month,
  );
}

export async function getAllTransactionsForMonth(month: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE substr(date, 1, 7) = ?
     ORDER BY date DESC, created_at DESC`,
    month,
  );
}

export async function getAccountSummaryForMonth(accountId: string, month: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions
     WHERE account_id = ? AND ${ACTIVE_FILTER} AND substr(date, 1, 7) = ?${cat.sql}`,
    accountId, month, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches WHERE account_id = ? ORDER BY imported_at DESC LIMIT 1`,
    accountId,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummaryForMonth(month: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions
     WHERE ${ACTIVE_FILTER} AND substr(date, 1, 7) = ?${cat.sql}`,
    month, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

// --- Year-level queries ---

export async function getTransactionsForYear(accountId: string, year: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE account_id = ? AND substr(date, 1, 4) = ?
     ORDER BY date DESC, created_at DESC`,
    accountId, year,
  );
}

export async function getAllTransactionsForYear(year: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE substr(date, 1, 4) = ?
     ORDER BY date DESC, created_at DESC`,
    year,
  );
}

export async function getAccountSummaryForYear(accountId: string, year: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions
     WHERE account_id = ? AND ${ACTIVE_FILTER} AND substr(date, 1, 4) = ?${cat.sql}`,
    accountId, year, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches WHERE account_id = ? ORDER BY imported_at DESC LIMIT 1`,
    accountId,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummaryForYear(year: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(amount_cents), 0) AS net_cents,
       COUNT(*) AS transaction_count
     FROM transactions
     WHERE ${ACTIVE_FILTER} AND substr(date, 1, 4) = ?${cat.sql}`,
    year, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getDistinctCategoryIdsForMonth(month: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category_id: string }>(
    `SELECT DISTINCT category_id FROM transactions
     WHERE ${ACTIVE_FILTER} AND substr(date, 1, 7) = ? AND category_id IS NOT NULL`,
    month,
  );
  return rows.map(r => r.category_id);
}

export async function getDistinctCategoryIdsForYear(year: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category_id: string }>(
    `SELECT DISTINCT category_id FROM transactions
     WHERE ${ACTIVE_FILTER} AND substr(date, 1, 4) = ? AND category_id IS NOT NULL`,
    year,
  );
  return rows.map(r => r.category_id);
}

// --- Categorization ---

export async function setTransactionCategory(
  txId: string,
  categoryId: string | null,
  manual: boolean,
  ruleId?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE transactions
     SET category_id = ?, category_set_manually = ?, applied_rule_id = ?
     WHERE id = ?`,
    categoryId, manual ? 1 : 0, ruleId ?? null, txId,
  );
}

export async function bulkManualSetCategory(
  transactionIds: string[],
  categoryId: string | null,
): Promise<void> {
  if (transactionIds.length === 0) return;
  const db = await getDb();
  // Chunk to stay within SQLite's default 999-variable limit
  const CHUNK = 500;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < transactionIds.length; i += CHUNK) {
      const chunk = transactionIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      await db.runAsync(
        `UPDATE transactions
         SET category_id = ?, category_set_manually = 1, applied_rule_id = NULL
         WHERE id IN (${placeholders})`,
        categoryId, ...chunk,
      );
    }
  });
}

export async function bulkSetTransactionCategories(
  assignments: Array<{ transactionId: string; categoryId: string; ruleId: string }>,
): Promise<void> {
  if (assignments.length === 0) return;
  const db = await getDb();
  // Each row uses 3 variables; chunk to stay well under the 999-variable SQLite limit
  const CHUNK = 100;
  // applied_rule_id contract (post migration 12): NULL, a real rules.id, or
  // 'foundational:<rule_id>'. Foundational IDs are persisted directly so the
  // standard getRuleAppliedCounts aggregate picks them up.
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < assignments.length; i += CHUNK) {
      const chunk = assignments.slice(i, i + CHUNK);
      const setCategoryCase  = chunk.map(() => 'WHEN id = ? THEN ?').join(' ');
      const setRuleCase      = chunk.map(() => 'WHEN id = ? THEN ?').join(' ');
      const inPlaceholders   = chunk.map(() => '?').join(', ');
      const params: string[] = [
        ...chunk.flatMap(a => [a.transactionId, a.categoryId]),
        ...chunk.flatMap(a => [a.transactionId, a.ruleId]),
        ...chunk.map(a => a.transactionId),
      ];
      await db.runAsync(
        `UPDATE transactions
         SET category_id      = CASE ${setCategoryCase} ELSE category_id END,
             applied_rule_id  = CASE ${setRuleCase} ELSE applied_rule_id END,
             category_set_manually = 0
         WHERE id IN (${inPlaceholders})
           AND category_set_manually = 0`,
        ...params,
      );
    }
  });
}

export async function getUncategorizedTransactionsForAccount(accountId: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE account_id = ? AND category_id IS NULL AND category_set_manually = 0 AND dropped_at IS NULL
     ORDER BY date DESC, created_at DESC`,
    accountId,
  );
}
