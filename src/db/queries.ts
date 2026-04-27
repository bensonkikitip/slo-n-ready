import { getDb } from './client';

export type AccountType = 'checking' | 'credit_card';
export type CsvFormat = 'boa_checking_v1' | 'citi_cc_v1';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  csv_format: CsvFormat;
  created_at: number;
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
    `INSERT INTO accounts (id, name, type, csv_format, created_at) VALUES (?, ?, ?, ?, ?)`,
    account.id,
    account.name,
    account.type,
    account.csv_format,
    account.created_at ?? Date.now(),
  );
}

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAllAsync<Account>(`SELECT * FROM accounts ORDER BY created_at ASC`);
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM accounts WHERE id = ?`, id);
}

// --- Import batches ---

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
