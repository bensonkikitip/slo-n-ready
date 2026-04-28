import { getDb } from './client';
import { ColumnConfig, DEFAULT_CONFIGS } from '../parsers/column-config';

export type AccountType = 'checking' | 'credit_card';
export type CsvFormat = 'boa_checking_v1' | 'citi_cc_v1';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  csv_format: CsvFormat;
  column_config: string; // JSON blob — use parseColumnConfig() to read
  created_at: number;
}

export function parseColumnConfig(account: Account): ColumnConfig {
  try {
    const parsed = JSON.parse(account.column_config);
    if (parsed && typeof parsed === 'object') return parsed as ColumnConfig;
  } catch {}
  return DEFAULT_CONFIGS[account.csv_format] ?? DEFAULT_CONFIGS['boa_checking_v1'];
}

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

export interface Category {
  id: string;
  name: string;
  color: string;
  created_at: number;
}

export type MatchType = 'contains' | 'starts_with' | 'ends_with' | 'equals';

export interface Rule {
  id: string;
  account_id: string;
  category_id: string;
  match_type: MatchType;
  match_text: string;
  priority: number;
  created_at: number;
}

export interface AccountSummary {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  transaction_count: number;
  last_imported_at: number | null;
}

// --- Accounts ---

export async function insertAccount(account: Omit<Account, 'created_at'> & { created_at?: number }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO accounts (id, name, type, csv_format, column_config, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    account.id,
    account.name,
    account.type,
    account.csv_format,
    account.column_config,
    account.created_at ?? Date.now(),
  );
}

export async function updateAccount(
  id: string,
  fields: { name?: string; type?: AccountType; csv_format?: CsvFormat; column_config?: string },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (fields.name !== undefined)          { sets.push('name = ?');          values.push(fields.name); }
  if (fields.type !== undefined)          { sets.push('type = ?');          values.push(fields.type); }
  if (fields.csv_format !== undefined)    { sets.push('csv_format = ?');    values.push(fields.csv_format); }
  if (fields.column_config !== undefined) { sets.push('column_config = ?'); values.push(fields.column_config); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAllAsync<Account>(`SELECT * FROM accounts ORDER BY created_at ASC`);
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM transactions   WHERE account_id = ?`, id);
    await db.runAsync(`DELETE FROM import_batches WHERE account_id = ?`, id);
    await db.runAsync(`DELETE FROM accounts       WHERE id = ?`, id);
  });
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

// --- Transactions ---

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
    // --- Pass 1: insert new rows, update pending→cleared for existing rows ---
    for (const row of rows) {
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO transactions
           (id, account_id, date, amount_cents, description, original_description,
            is_pending, dropped_at, import_batch_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        row.id,
        accountId,
        row.date,
        row.amount_cents,
        row.description,
        row.original_description,
        row.is_pending ? 1 : 0,
        batchId,
        now,
      );

      if (result.changes > 0) {
        inserted++;
      } else if (!row.is_pending) {
        // Row already exists. If the incoming data says it cleared, update the flag.
        // Only touches is_pending; leaves everything else (description, amount, etc.) intact.
        const update = await db.runAsync(
          `UPDATE transactions
             SET is_pending = 0
           WHERE id = ? AND is_pending = 1 AND dropped_at IS NULL`,
          row.id,
        );
        if (update.changes > 0) cleared++;
      }
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
        accountId,
        minDate,
        maxDate,
      );

      for (const p of pendingInRange) {
        if (!importedIds.has(p.id)) {
          await db.runAsync(
            `UPDATE transactions SET dropped_at = ? WHERE id = ?`,
            now,
            p.id,
          );
          dropped++;
        }
      }
    }
  });

  const skipped = rows.length - inserted - cleared;
  return { inserted, cleared, dropped, skipped, total: rows.length };
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

// --- Categories ---

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>(`SELECT * FROM categories ORDER BY name ASC`);
}

export async function insertCategory(category: Omit<Category, 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
    category.id, category.name, category.color, Date.now(),
  );
}

export async function updateCategory(id: string, fields: { name?: string; color?: string }): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: string[] = [];
  if (fields.name  !== undefined) { sets.push('name = ?');  values.push(fields.name); }
  if (fields.color !== undefined) { sets.push('color = ?'); values.push(fields.color); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM categories WHERE id = ?`, id);
}

// --- Rules ---

export async function getRulesForAccount(accountId: string): Promise<Rule[]> {
  const db = await getDb();
  return db.getAllAsync<Rule>(
    `SELECT * FROM rules WHERE account_id = ? ORDER BY priority ASC`,
    accountId,
  );
}

export async function insertRule(rule: Omit<Rule, 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO rules (id, account_id, category_id, match_type, match_text, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    rule.id, rule.account_id, rule.category_id, rule.match_type,
    rule.match_text, rule.priority, Date.now(),
  );
}

export async function updateRule(
  id: string,
  fields: { match_type?: MatchType; match_text?: string; category_id?: string },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: string[] = [];
  if (fields.match_type  !== undefined) { sets.push('match_type = ?');  values.push(fields.match_type); }
  if (fields.match_text  !== undefined) { sets.push('match_text = ?');  values.push(fields.match_text); }
  if (fields.category_id !== undefined) { sets.push('category_id = ?'); values.push(fields.category_id); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE rules SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteRule(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM rules WHERE id = ?`, id);
}

export async function reorderRules(orderedIds: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(`UPDATE rules SET priority = ? WHERE id = ?`, i + 1, orderedIds[i]);
    }
  });
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
  await db.withTransactionAsync(async () => {
    for (const id of transactionIds) {
      await db.runAsync(
        `UPDATE transactions
         SET category_id = ?, category_set_manually = 1, applied_rule_id = NULL
         WHERE id = ?`,
        categoryId, id,
      );
    }
  });
}

export async function bulkSetTransactionCategories(
  assignments: Array<{ transactionId: string; categoryId: string; ruleId: string }>,
): Promise<void> {
  if (assignments.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const a of assignments) {
      await db.runAsync(
        `UPDATE transactions
         SET category_id = ?, category_set_manually = 0, applied_rule_id = ?
         WHERE id = ? AND category_set_manually = 0`,
        a.categoryId, a.ruleId, a.transactionId,
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
