import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

const LATEST_DB_VERSION = 10;

// Written before any migration runs so the user can always roll back.
// Uses the same path and format as writeBackup() in backup.ts.
// Each table query is individually guarded — if a table doesn't exist yet
// (e.g. rules before migration 005) it is recorded as an empty array.
async function writePreMigrationBackup(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const safe = async (sql: string) => {
      try { return await db.getAllAsync<any>(sql); } catch { return []; }
    };
    const [accounts, import_batches, transactions, categories, rules] = await Promise.all([
      safe('SELECT * FROM accounts ORDER BY created_at ASC'),
      safe('SELECT * FROM import_batches ORDER BY imported_at ASC'),
      safe('SELECT * FROM transactions ORDER BY created_at ASC'),
      safe('SELECT * FROM categories ORDER BY created_at ASC'),
      safe('SELECT * FROM rules ORDER BY priority ASC'),
    ]);
    const payload = JSON.stringify({
      version: 2, exported_at: Date.now(),
      accounts, import_batches, transactions, categories, rules,
    });
    const path = (FileSystem.documentDirectory ?? '') + 'slo-n-ready-backup.json';
    await FileSystem.writeAsStringAsync(path, payload);
  } catch {
    // Never block a migration because a backup failed
  }
}

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
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = _init();
  return _initPromise;
}

async function _init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('budgetapp.db');

  // SQLite disables FK constraints by default — enable them so ON DELETE CASCADE works
  await db.execAsync('PRAGMA foreign_keys = ON');

  // Run base schema (idempotent via CREATE TABLE IF NOT EXISTS)
  await db.execAsync(INIT_SQL);

  // Run any pending migrations
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = versionRow?.user_version ?? 0;

  // Snapshot data before any migration so the user can always restore if something goes wrong
  if (version < LATEST_DB_VERSION) {
    await writePreMigrationBackup(db);
  }

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

  if (version < 6) {
    // Expand the match_type CHECK constraint to include amount_eq/lt/gt.
    // SQLite can't ALTER a CHECK constraint, so we recreate the table.
    // This migration is written to be safe on retry: drops any leftover
    // rules_new from a previous partial run, and only copies/drops the
    // original rules table if it still exists.
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      // Clean up any leftover from a previously interrupted run
      await db.execAsync('DROP TABLE IF EXISTS rules_new');

      await db.execAsync(`
        CREATE TABLE rules_new (
          id          TEXT PRIMARY KEY,
          account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          match_type  TEXT NOT NULL CHECK (match_type IN (
            'contains','starts_with','ends_with','equals',
            'amount_eq','amount_lt','amount_gt'
          )),
          match_text  TEXT NOT NULL,
          priority    INTEGER NOT NULL DEFAULT 100,
          created_at  INTEGER NOT NULL
        )
      `);

      // Only copy + drop the old table if it still exists
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='rules'`,
      );
      if (row && row.n > 0) {
        await db.execAsync(`INSERT INTO rules_new SELECT * FROM rules`);
        await db.execAsync(`DROP TABLE rules`);
      }

      await db.execAsync(`ALTER TABLE rules_new RENAME TO rules`);
      await db.execAsync(`DROP INDEX IF EXISTS idx_rules_account_priority`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_rules_account_priority ON rules (account_id, priority ASC)`);

      // Only mark complete if every step above succeeded
      await db.execAsync('PRAGMA user_version = 6');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  }

  if (version < 7) {
    // Add multi-condition support: logic (AND/OR) and conditions (JSON array)
    try { await db.execAsync(`ALTER TABLE rules ADD COLUMN logic TEXT NOT NULL DEFAULT 'AND'`); } catch {}
    try { await db.execAsync(`ALTER TABLE rules ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]'`); } catch {}
    // Backfill existing single-condition rules into the new conditions column
    const existing = await db.getAllAsync<{ id: string; match_type: string; match_text: string }>(
      `SELECT id, match_type, match_text FROM rules WHERE conditions = '[]' OR conditions IS NULL`,
    );
    for (const r of existing) {
      await db.runAsync(
        `UPDATE rules SET conditions = ? WHERE id = ?`,
        JSON.stringify([{ match_type: r.match_type, match_text: r.match_text }]),
        r.id,
      );
    }
    await db.execAsync('PRAGMA user_version = 7');
  }

  if (version < 8) {
    try { await db.execAsync(`ALTER TABLE accounts ADD COLUMN suggest_rules INTEGER NOT NULL DEFAULT 1`); } catch {}
    await db.execAsync('PRAGMA user_version = 8');
  }

  if (version < 9) {
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS budgets (
          account_id   TEXT NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
          category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          month        TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          PRIMARY KEY (account_id, category_id, month)
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_budgets_account_month ON budgets (account_id, month)
      `);
    } catch {}
    await db.execAsync('PRAGMA user_version = 9');
  }

  if (version < 10) {
    // v4.0: categories get emoji + description columns (nullable, additive)
    try { await db.execAsync(`ALTER TABLE categories ADD COLUMN emoji TEXT`); } catch {}
    try { await db.execAsync(`ALTER TABLE categories ADD COLUMN description TEXT`); } catch {}

    // v4.0: per-account foundational rule settings (enabled flag + category mapping)
    // Logic lives in code (foundational-rules.ts); user state lives here.
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS foundational_rule_settings (
          account_id  TEXT NOT NULL,
          rule_id     TEXT NOT NULL,
          category_id TEXT,
          enabled     INTEGER NOT NULL DEFAULT 1,
          created_at  INTEGER NOT NULL,
          PRIMARY KEY (account_id, rule_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_foundational_settings_account
        ON foundational_rule_settings(account_id)
      `);
    } catch {}

    // v4.0: lightweight key/value preferences table (v4_welcomed flag lives here)
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_preferences (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    } catch {}

    await db.execAsync('PRAGMA user_version = 10');
  }

  _db = db;
  return db;
}

