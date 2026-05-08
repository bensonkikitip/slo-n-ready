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
  /** 0 = imported from CSV/PDF; 1 = entered manually via the Add screen */
  source_is_manual: number;
}

/** A manual/imported pair identified as a potential duplicate during reconciliation. */
export interface ReconciliationPair {
  manualTx: {
    id: string;
    date: string;
    amount_cents: number;
    description: string;
    category_id: string | null;
    category_set_manually: number;
  };
  importedTx: {
    id: string;
    date: string;
    description: string;
  };
}

export interface AccountSummary {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  excluded_cents: number;     // v4.6 — sum of transactions in excluded categories (not in income/expense/net)
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
    // 11 cols, 9 bound params per row (dropped_at=NULL, source_is_manual=0 are literals)
    // 9 × 75 = 675 params, under SQLite's 999-variable limit
    const newRows = rows.filter(r => !existingIds.has(r.id));
    inserted = newRows.length;
    const INSERT_CHUNK = 75;
    const newRowCols = '(?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)';
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
            is_pending, dropped_at, import_batch_id, created_at, source_is_manual)
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

// --- Manual entry ---

/**
 * The singleton batch ID for manual transactions on a given account.
 * Using INSERT OR IGNORE on this batch means no schema migration is needed:
 * the first manual entry creates the batch, subsequent ones reuse it.
 */
export function manualBatchId(accountId: string): string {
  return `manual-${accountId}`;
}

/**
 * Insert a single manually-entered transaction.
 *
 * Uses a singleton "manual" import batch (INSERT OR IGNORE) so no schema
 * migration is needed. The transaction ID is deterministic — re-inserting
 * the exact same (date, amount, description) triplet for the same account
 * is silently ignored (idempotent).
 *
 * @returns The new transaction's ID, or null if it was a duplicate.
 */
export async function insertManualTransaction(
  accountId: string,
  dateIso: string,
  amountCents: number,
  description: string,
): Promise<string | null> {
  const db = await getDb();
  const batchId = manualBatchId(accountId);
  const now = Date.now();

  // Ensure the singleton manual batch exists
  await db.runAsync(
    `INSERT OR IGNORE INTO import_batches
       (id, account_id, filename, imported_at, rows_total, rows_inserted,
        rows_skipped_duplicate, rows_cleared, rows_dropped)
     VALUES (?, ?, '(manual entries)', ?, 0, 0, 0, 0, 0)`,
    batchId, accountId, now,
  );

  // Deterministic ID — same as CSV import pipeline
  const { sha256 } = require('js-sha256') as typeof import('js-sha256');
  const { normalizeDescription } = require('../../domain/normalize') as typeof import('../../domain/normalize');
  const normalised = normalizeDescription(description);
  const baseKey = sha256(`${accountId}|${dateIso}|${amountCents}|${normalised}`);
  const txId = sha256(`${baseKey}|0`).slice(0, 32);

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO transactions
       (id, account_id, date, amount_cents, description, original_description,
        is_pending, dropped_at, import_batch_id, created_at, source_is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 1)`,
    txId, accountId, dateIso, amountCents,
    normalised, description,
    batchId, now,
  );

  return (result.changes ?? 0) > 0 ? txId : null;
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
    income_cents: number; expense_cents: number;
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.account_id = ? AND t.${ACTIVE_FILTER}`,
    accountId,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches WHERE account_id = ? ORDER BY imported_at DESC LIMIT 1`,
    accountId,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    excluded_cents:    row?.excluded_cents    ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummary(): Promise<AccountSummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.${ACTIVE_FILTER}`,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    excluded_cents:    row?.excluded_cents    ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
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
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.account_id = ? AND t.${ACTIVE_FILTER} AND substr(t.date, 1, 7) = ?${cat.sql}`,
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
    excluded_cents:    row?.excluded_cents    ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummaryForMonth(month: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.${ACTIVE_FILTER} AND substr(t.date, 1, 7) = ?${cat.sql}`,
    month, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    excluded_cents:    row?.excluded_cents    ?? 0,
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
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.account_id = ? AND t.${ACTIVE_FILTER} AND substr(t.date, 1, 4) = ?${cat.sql}`,
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
    excluded_cents:    row?.excluded_cents    ?? 0,
    transaction_count: row?.transaction_count ?? 0,
    last_imported_at:  lastBatch?.imported_at ?? null,
  };
}

export async function getAllAccountsSummaryForYear(year: string, categoryIds: string[] = []): Promise<AccountSummary> {
  const db = await getDb();
  const cat = catClause(categoryIds);
  const row = await db.getFirstAsync<{
    income_cents: number; expense_cents: number;
    net_cents: number; excluded_cents: number; transaction_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN t.amount_cents > 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN t.amount_cents < 0
         AND (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
       COALESCE(SUM(CASE WHEN (c.exclude_from_totals IS NULL OR c.exclude_from_totals = 0)
         THEN t.amount_cents ELSE 0 END), 0) AS net_cents,
       COALESCE(SUM(CASE WHEN c.exclude_from_totals = 1
         THEN t.amount_cents ELSE 0 END), 0) AS excluded_cents,
       COUNT(*) AS transaction_count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.${ACTIVE_FILTER} AND substr(t.date, 1, 4) = ?${cat.sql}`,
    year, ...cat.params,
  );
  const lastBatch = await db.getFirstAsync<{ imported_at: number }>(
    `SELECT imported_at FROM import_batches ORDER BY imported_at DESC LIMIT 1`,
  );
  return {
    income_cents:      row?.income_cents      ?? 0,
    expense_cents:     row?.expense_cents     ?? 0,
    net_cents:         row?.net_cents         ?? 0,
    excluded_cents:    row?.excluded_cents    ?? 0,
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

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Find manual transactions that are potential duplicates of transactions in
 * a specific import batch. Match criteria: same account, same amount_cents,
 * date within ±1 day. Returns at most one imported-tx partner per manual tx.
 *
 * Used after import confirms to offer the user a chance to merge/delete the
 * manual entries that the import has now made redundant.
 */
// ─── Transaction edit / delete mutations ─────────────────────────────────────

/**
 * Update the core fields of any transaction in place. The row ID stays the
 * same — deterministic IDs are an import-pipeline concern; editing a row after
 * import does not affect re-import dedup behaviour (the original data still
 * hashes to the same ID via the algorithm, and INSERT OR IGNORE skips it).
 *
 * category_id / category_set_manually / applied_rule_id are intentionally NOT
 * touched here — use setTransactionCategory for those.
 */
export async function updateTransaction(
  id: string,
  fields: { dateIso: string; amountCents: number; description: string },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE transactions
     SET date = ?, amount_cents = ?, description = ?
     WHERE id = ?`,
    fields.dateIso, fields.amountCents, fields.description, id,
  );
}

/**
 * Hard-delete a transaction from the database.
 * Only for manual transactions (source_is_manual = 1). Manual entries were
 * never in a bank feed, so preserving them as dropped rows is unnecessary.
 */
export async function hardDeleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, id);
}

/**
 * Soft-delete a transaction by setting dropped_at.
 * For imported transactions (source_is_manual = 0): preserves the audit trail.
 * The row is excluded from all active-filter queries via `dropped_at IS NULL`.
 */
export async function softDropTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE transactions SET dropped_at = ? WHERE id = ?`,
    Date.now(), id,
  );
}

// ─── Cross-import duplicate detection ────────────────────────────────────────

export interface CrossImportDupePair {
  newTx: {
    id: string;
    date: string;
    amount_cents: number;
    description: string;
  };
  existingTx: {
    id: string;
    date: string;
    description: string;
    import_batch_id: string;
  };
}

/**
 * Find rows in `batchId` that probably already exist in the account from an
 * earlier import (same amount_cents, dates within 1 day, different batch).
 *
 * One pair per new-batch row — if multiple earlier rows match, only the first
 * (by rowid) is surfaced. Only active (dropped_at IS NULL), non-manual rows.
 */
export async function findCrossImportDuplicates(
  accountId: string,
  batchId: string,
): Promise<CrossImportDupePair[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    new_id: string; new_date: string; new_amount_cents: number; new_description: string;
    existing_id: string; existing_date: string; existing_description: string;
    existing_batch_id: string;
  }>(
    `SELECT
       n.id           AS new_id,
       n.date         AS new_date,
       n.amount_cents AS new_amount_cents,
       n.description  AS new_description,
       e.id           AS existing_id,
       e.date         AS existing_date,
       e.description  AS existing_description,
       e.import_batch_id AS existing_batch_id
     FROM transactions n
     JOIN transactions e
       ON  e.account_id    = n.account_id
       AND e.amount_cents  = n.amount_cents
       AND abs(julianday(e.date) - julianday(n.date)) <= 1
       AND e.import_batch_id != n.import_batch_id
       AND e.dropped_at IS NULL
       AND e.source_is_manual = 0
     WHERE n.import_batch_id = ?
       AND n.account_id      = ?
       AND n.dropped_at IS NULL
     GROUP BY n.id
     ORDER BY n.date DESC`,
    batchId, accountId,
  );

  return rows.map(r => ({
    newTx: {
      id:           r.new_id,
      date:         r.new_date,
      amount_cents: r.new_amount_cents,
      description:  r.new_description,
    },
    existingTx: {
      id:              r.existing_id,
      date:            r.existing_date,
      description:     r.existing_description,
      import_batch_id: r.existing_batch_id,
    },
  }));
}

// ─── Reconciliation (manual ↔ imported) ──────────────────────────────────────

export async function findReconciliationCandidates(
  accountId: string,
  batchId: string,
): Promise<ReconciliationPair[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    manual_id: string;
    manual_date: string;
    manual_amount_cents: number;
    manual_description: string;
    manual_category_id: string | null;
    manual_category_set_manually: number;
    imported_id: string;
    imported_date: string;
    imported_description: string;
  }>(
    `SELECT
       m.id                     AS manual_id,
       m.date                   AS manual_date,
       m.amount_cents           AS manual_amount_cents,
       m.description            AS manual_description,
       m.category_id            AS manual_category_id,
       m.category_set_manually  AS manual_category_set_manually,
       i.id                     AS imported_id,
       i.date                   AS imported_date,
       i.description            AS imported_description
     FROM transactions m
     JOIN (
       SELECT * FROM transactions
       WHERE import_batch_id = ? AND account_id = ? AND dropped_at IS NULL
     ) i ON  i.account_id   = m.account_id
         AND i.amount_cents = m.amount_cents
         AND abs(julianday(i.date) - julianday(m.date)) <= 1
     WHERE m.source_is_manual = 1
       AND m.account_id        = ?
       AND m.dropped_at IS NULL
     GROUP BY m.id
     ORDER BY m.date DESC`,
    batchId, accountId, accountId,
  );

  return rows.map(r => ({
    manualTx: {
      id:                    r.manual_id,
      date:                  r.manual_date,
      amount_cents:          r.manual_amount_cents,
      description:           r.manual_description,
      category_id:           r.manual_category_id,
      category_set_manually: r.manual_category_set_manually,
    },
    importedTx: {
      id:          r.imported_id,
      date:        r.imported_date,
      description: r.imported_description,
    },
  }));
}

/**
 * Merge a manual transaction into its imported counterpart:
 * - If the manual tx had a user-set category, copy it to the imported tx.
 * - Hard-delete the manual tx (it was never in a bank feed, so dropped_at
 *   doesn't apply — a hard delete is the correct semantic here).
 *
 * Wrapped in a DB transaction so the copy + delete are atomic.
 */
export async function mergeManualIntoImported(
  manualId: string,
  importedId: string,
  manualCategoryId: string | null,
  manualCategorySetManually: number,
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // Copy category only when the user explicitly set it on the manual entry.
    if (manualCategorySetManually === 1 && manualCategoryId !== null) {
      await db.runAsync(
        `UPDATE transactions
         SET category_id           = ?,
             category_set_manually = 1,
             applied_rule_id       = NULL
         WHERE id = ?`,
        manualCategoryId, importedId,
      );
    }
    // Hard-delete: manual transactions were never part of a bank feed, so
    // the dropped_at soft-delete pattern doesn't apply here.
    await db.runAsync(`DELETE FROM transactions WHERE id = ?`, manualId);
  });
}
