import * as SQLite from 'expo-sqlite';

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('checking', 'credit_card')),
  csv_format TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id                     TEXT PRIMARY KEY,
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filename               TEXT,
  imported_at            INTEGER NOT NULL,
  rows_total             INTEGER NOT NULL,
  rows_inserted          INTEGER NOT NULL,
  rows_skipped_duplicate INTEGER NOT NULL,
  rows_cleared           INTEGER NOT NULL DEFAULT 0,
  rows_dropped           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date                 TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  description          TEXT NOT NULL,
  original_description TEXT NOT NULL,
  is_pending           INTEGER NOT NULL DEFAULT 0,
  dropped_at           INTEGER DEFAULT NULL,
  import_batch_id      TEXT NOT NULL REFERENCES import_batches(id),
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions (account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_date         ON transactions (date DESC);
`;

// Migration 002: adds dropped_at to transactions and rows_cleared/rows_dropped
// to import_batches. Uses SQLite's user_version pragma to track schema version.
const MIGRATION_002 = `
ALTER TABLE transactions ADD COLUMN dropped_at INTEGER DEFAULT NULL;
ALTER TABLE import_batches ADD COLUMN rows_cleared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN rows_dropped INTEGER NOT NULL DEFAULT 0;
`;

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  const db = await SQLite.openDatabaseAsync('budgetapp.db');

  // SQLite disables FK constraints by default — enable them so ON DELETE CASCADE works
  await db.execAsync('PRAGMA foreign_keys = ON');

  // Run base schema (idempotent via CREATE TABLE IF NOT EXISTS)
  await db.execAsync(INIT_SQL);

  // Run any pending migrations
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = versionRow?.user_version ?? 0;

  if (version < 2) {
    // ALTER TABLE is not transactional in SQLite, so we run each statement
    // individually and guard with a try/catch in case the column already exists
    // (e.g. fresh install that got INIT_SQL with the column already present).
    try { await db.execAsync('ALTER TABLE transactions ADD COLUMN dropped_at INTEGER DEFAULT NULL'); } catch {}
    try { await db.execAsync('ALTER TABLE import_batches ADD COLUMN rows_cleared INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { await db.execAsync('ALTER TABLE import_batches ADD COLUMN rows_dropped INTEGER NOT NULL DEFAULT 0'); } catch {}
    await db.execAsync('PRAGMA user_version = 2');
  }

  if (version < 3) {
    try { await db.execAsync('ALTER TABLE accounts ADD COLUMN column_config TEXT'); } catch {}
    // Backfill defaults for accounts created before v1.2
    const boaDefault = JSON.stringify({
      dateColumn: 'Date', descriptionColumn: 'Description', dateFormat: 'MM/DD/YYYY',
      amountStyle: 'signed', signedAmountColumn: 'Amount', headerContains: 'Date,Description,Amount',
    });
    const citiDefault = JSON.stringify({
      dateColumn: 'Date', descriptionColumn: 'Description', dateFormat: 'MM/DD/YYYY',
      amountStyle: 'debit_credit', debitColumn: 'Debit', creditColumn: 'Credit',
      pendingColumn: 'Status', clearedValue: 'Cleared',
    });
    await db.runAsync(
      `UPDATE accounts SET column_config = ? WHERE csv_format = 'boa_checking_v1' AND column_config IS NULL`,
      boaDefault,
    );
    await db.runAsync(
      `UPDATE accounts SET column_config = ? WHERE csv_format = 'citi_cc_v1' AND column_config IS NULL`,
      citiDefault,
    );
    await db.execAsync('PRAGMA user_version = 3');
  }

  if (version < 4) {
    // Clean up orphaned rows left by accounts that were deleted without FK constraints active
    await db.execAsync(
      `DELETE FROM transactions   WHERE account_id    NOT IN (SELECT id FROM accounts)`,
    );
    await db.execAsync(
      `DELETE FROM import_batches WHERE account_id    NOT IN (SELECT id FROM accounts)`,
    );
    await db.execAsync('PRAGMA user_version = 4');
  }

  if (version < 5) {
    try { await db.execAsync(`CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL
    )`); } catch {}
    try { await db.execAsync(`CREATE TABLE IF NOT EXISTS rules (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      match_type  TEXT NOT NULL CHECK (match_type IN ('contains','starts_with','ends_with','equals')),
      match_text  TEXT NOT NULL,
      priority    INTEGER NOT NULL DEFAULT 100,
      created_at  INTEGER NOT NULL
    )`); } catch {}
    try { await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_rules_account_priority ON rules (account_id, priority ASC)`); } catch {}
    try { await db.execAsync(`ALTER TABLE transactions ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL`); } catch {}
    try { await db.execAsync(`ALTER TABLE transactions ADD COLUMN category_set_manually INTEGER NOT NULL DEFAULT 0`); } catch {}
    try { await db.execAsync(`ALTER TABLE transactions ADD COLUMN applied_rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL`); } catch {}
    await db.execAsync('PRAGMA user_version = 5');
  }

  _db = db;
  return db;
}
