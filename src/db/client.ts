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

  _db = db;
  return db;
}
