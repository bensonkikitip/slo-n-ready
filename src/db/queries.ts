import { getDb } from './client';
import { ColumnConfig, DEFAULT_CONFIGS } from '../parsers/column-config';

export type AccountType = 'checking' | 'credit_card';
export type CsvFormat = 'boa_checking_v1' | 'citi_cc_v1' | 'custom';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  csv_format: CsvFormat;
  column_config: string; // JSON blob — use parseColumnConfig() to read
  created_at: number;
  suggest_rules: number; // 1 = show rule suggestion after manual categorization, 0 = show undo banner only
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
  emoji: string | null;        // v4.0 — nullable; legacy rows have null
  description: string | null;  // v4.0 — nullable; shown in starter-category UI
  created_at: number;
}

export type MatchType = 'contains' | 'starts_with' | 'ends_with' | 'equals' | 'amount_eq' | 'amount_lt' | 'amount_gt';

export interface RuleCondition {
  match_type: MatchType;
  match_text: string;
}

export interface Rule {
  id: string;
  account_id: string;
  category_id: string;
  match_type: MatchType;      // mirrors conditions[0] — kept for backward compat
  match_text: string;         // mirrors conditions[0] — kept for backward compat
  logic: 'AND' | 'OR';
  conditions: RuleCondition[];
  priority: number;
  created_at: number;
}

function parseRuleConditions(row: any): RuleCondition[] {
  try {
    const parsed = JSON.parse(row.conditions ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return [{ match_type: row.match_type, match_text: row.match_text }];
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

export async function updateAccountSuggestRules(id: string, value: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE accounts SET suggest_rules = ? WHERE id = ?`, value, id);
}

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAllAsync<Account>(`SELECT * FROM accounts ORDER BY created_at ASC`);
}

export async function deleteAccount(id: string): Promise<void> {
  // FK ON DELETE CASCADE (with PRAGMA foreign_keys = ON in getDb) handles
  // transactions, import_batches, rules, budgets, and foundational_rule_settings.
  const db = await getDb();
  await db.runAsync(`DELETE FROM accounts WHERE id = ?`, id);
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
    `INSERT INTO categories (id, name, color, emoji, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    category.id, category.name, category.color,
    category.emoji ?? null, category.description ?? null,
    Date.now(),
  );
}

export async function updateCategory(
  id: string,
  fields: { name?: string; color?: string; emoji?: string | null; description?: string | null },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (fields.name        !== undefined) { sets.push('name = ?');        values.push(fields.name); }
  if (fields.color       !== undefined) { sets.push('color = ?');       values.push(fields.color); }
  if (fields.emoji       !== undefined) { sets.push('emoji = ?');       values.push(fields.emoji ?? null); }
  if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM categories WHERE id = ?`, id);
}

/**
 * Bulk-insert categories in a single transaction. Used by the first-time
 * onboarding flow to seed the user's starter categories. Idempotent on (id) —
 * uses INSERT OR IGNORE so re-runs don't error.
 */
export async function bulkInsertCategories(
  rows: Omit<Category, 'created_at'>[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const c of rows) {
      await db.runAsync(
        `INSERT OR IGNORE INTO categories (id, name, color, emoji, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        c.id, c.name, c.color, c.emoji ?? null, c.description ?? null, now,
      );
    }
  });
}

// --- Rules ---

export async function getRulesForAccount(accountId: string): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM rules WHERE account_id = ? ORDER BY priority ASC`,
    accountId,
  );
  return rows.map(r => ({
    ...r,
    logic:      (r.logic ?? 'AND') as 'AND' | 'OR',
    conditions: parseRuleConditions(r),
  }));
}

export async function insertRule(rule: Omit<Rule, 'created_at'>): Promise<void> {
  const db = await getDb();
  const first = rule.conditions?.[0] ?? { match_type: rule.match_type, match_text: rule.match_text };
  await db.runAsync(
    `INSERT INTO rules (id, account_id, category_id, match_type, match_text, logic, conditions, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rule.id, rule.account_id, rule.category_id,
    first.match_type, first.match_text,
    rule.logic ?? 'AND',
    JSON.stringify(rule.conditions ?? [first]),
    rule.priority, Date.now(),
  );
}

export async function updateRule(
  id: string,
  fields: {
    match_type?: MatchType; match_text?: string; category_id?: string;
    logic?: 'AND' | 'OR'; conditions?: RuleCondition[];
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: any[] = [];
  if (fields.match_type  !== undefined) { sets.push('match_type = ?');  values.push(fields.match_type); }
  if (fields.match_text  !== undefined) { sets.push('match_text = ?');  values.push(fields.match_text); }
  if (fields.category_id !== undefined) { sets.push('category_id = ?'); values.push(fields.category_id); }
  if (fields.logic       !== undefined) { sets.push('logic = ?');       values.push(fields.logic); }
  if (fields.conditions  !== undefined) { sets.push('conditions = ?');  values.push(JSON.stringify(fields.conditions)); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE rules SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteRule(id: string): Promise<void> {
  // Migration 12 dropped the FK on transactions.applied_rule_id, so the
  // previous ON DELETE SET NULL behavior is now enforced here in code.
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE transactions SET applied_rule_id = NULL WHERE applied_rule_id = ?`, id);
    await db.runAsync(`DELETE FROM rules WHERE id = ?`, id);
  });
}

export async function reorderRules(orderedIds: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(`UPDATE rules SET priority = ? WHERE id = ?`, i + 1, orderedIds[i]);
    }
  });
}

export async function getRuleAppliedCounts(accountId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ rule_id: string; count: number }>(
    `SELECT applied_rule_id AS rule_id, COUNT(*) AS count
     FROM transactions
     WHERE account_id = ? AND applied_rule_id IS NOT NULL AND dropped_at IS NULL
     GROUP BY applied_rule_id`,
    accountId,
  );
  return Object.fromEntries(rows.map(r => [r.rule_id, r.count]));
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

// --- Budgets ---

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

// --- Foundational rule settings (v4.0) ---
// Logic for each foundational rule lives in src/domain/foundational-rules.ts.
// User state (enabled flag + category mapping) lives here, keyed per account.

export interface FoundationalRuleSetting {
  account_id:  string;
  rule_id:     string;   // matches FoundationalRule.id, e.g. "food-dining"
  category_id: string | null;
  enabled:     number;   // 1 = enabled, 0 = disabled
  sort_order:  number;   // display/run order within this account (lower = earlier)
  created_at:  number;
}

export async function getFoundationalRuleSettingsForAccount(
  accountId: string,
): Promise<FoundationalRuleSetting[]> {
  const db = await getDb();
  return db.getAllAsync<FoundationalRuleSetting>(
    `SELECT * FROM foundational_rule_settings WHERE account_id = ?`,
    accountId,
  );
}

/** Upsert the category + enabled state for one foundational rule on one account. */
export async function upsertFoundationalRuleSetting(
  accountId:  string,
  ruleId:     string,
  categoryId: string | null,
  enabled:    number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO foundational_rule_settings (account_id, rule_id, category_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, rule_id) DO UPDATE SET category_id = excluded.category_id,
                                                     enabled     = excluded.enabled`,
    accountId, ruleId, categoryId, enabled, Date.now(),
  );
}

/**
 * Bulk-upsert foundational rule settings for one account in a single
 * transaction. Used by the per-account foundational-rules onboarding screen.
 * Pass sort_order on each row to persist the display/run order; it defaults
 * to the row's position in the array when omitted.
 */
export async function bulkUpsertFoundationalRuleSettings(
  accountId: string,
  rows: { rule_id: string; category_id: string | null; enabled: number; sort_order?: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sortOrder = r.sort_order ?? i;
      await db.runAsync(
        `INSERT INTO foundational_rule_settings (account_id, rule_id, category_id, enabled, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, rule_id) DO UPDATE SET category_id = excluded.category_id,
                                                         enabled     = excluded.enabled,
                                                         sort_order  = excluded.sort_order`,
        accountId, r.rule_id, r.category_id, r.enabled, sortOrder, now,
      );
    }
  });
}

/**
 * Persist a new display/run order for foundational rules on one account.
 * Pass the rule IDs in the desired order (index 0 = highest priority).
 */
export async function reorderFoundationalRules(
  accountId: string,
  orderedRuleIds: string[],
): Promise<void> {
  if (orderedRuleIds.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedRuleIds.length; i++) {
      await db.runAsync(
        `UPDATE foundational_rule_settings SET sort_order = ? WHERE account_id = ? AND rule_id = ?`,
        i, accountId, orderedRuleIds[i],
      );
    }
  });
}

/**
 * Returns Rule-shaped objects (id prefixed "foundational:<rule_id>") for all
 * enabled foundational rules that have a category mapped for this account.
 *
 * INVARIANT: a rule with no category_id is NEVER returned, even if enabled = 1.
 * This mirrors the UI constraint (toggle disabled without a category) and the DB
 * filter here as a belt-and-suspenders guarantee.
 */
export async function getActiveFoundationalRulesAsRules(accountId: string): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FoundationalRuleSetting>(
    `SELECT * FROM foundational_rule_settings
     WHERE account_id = ? AND enabled = 1 AND category_id IS NOT NULL
     ORDER BY sort_order ASC`,
    accountId,
  );
  // Lazy import to avoid circular deps; foundational-rules.ts imports from queries.ts
  // only for the RuleCondition type, which is fine.
  const { FOUNDATIONAL_RULES } = await import('../domain/foundational-rules');
  const ruleMap = new Map(FOUNDATIONAL_RULES.map(r => [r.id, r]));

  return rows
    .map(setting => {
      const fr = ruleMap.get(setting.rule_id);
      if (!fr || !setting.category_id) return null;
      const first = fr.conditions[0];
      return {
        id:          `foundational:${fr.id}`,
        account_id:  accountId,
        category_id: setting.category_id,
        match_type:  first.match_type,
        match_text:  first.match_text,
        logic:       fr.logic as 'AND' | 'OR',
        conditions:  fr.conditions,
        priority:    9999,  // always last — user rules are lower numbers
        created_at:  setting.created_at,
      } satisfies Rule;
    })
    .filter((r): r is Rule => r !== null);
}

// --- App preferences (v4.0) ---
// Lightweight key/value store for app-level flags.
// v4.0 keys: "v4_welcomed" (set to "true" after welcome sheet dismisses)

export async function getPreference(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_preferences WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

export async function setPreference(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, value, Date.now(),
  );
}
