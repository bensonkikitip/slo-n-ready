import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { snapshotAllTables, BACKUP_PATH } from './backup';

const LATEST_DB_VERSION = 13;

// Written before any migration runs so the user can always roll back.
// Uses snapshotAllTables (in backup.ts) so the file format always matches the
// current backup version and table set automatically — adding a new table to
// the backup doesn't require touching this function.
async function writePreMigrationBackup(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const data = await snapshotAllTables(db);
    await FileSystem.writeAsStringAsync(BACKUP_PATH, JSON.stringify(data));
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

  if (version < 11) {
    // v4.1: per-account sort order for foundational rules.
    // Adds sort_order to foundational_rule_settings so users can reorder rules per account.
    // Default order matches the globally-optimal permutation (food=0 … health=5).
    try {
      await db.execAsync(
        `ALTER TABLE foundational_rule_settings ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
      );
    } catch {}
    // Backfill existing rows to the default optimal order (food-dining first, health last).
    // Rows that don't exist yet get the default via the column DEFAULT above.
    const defaultOrder: Record<string, number> = {
      'food-dining':    0,
      'groceries':      1,
      'transportation': 2,
      'entertainment':  3,
      'shopping':       4,
      'health':         5,
    };
    for (const [ruleId, pos] of Object.entries(defaultOrder)) {
      try {
        await db.runAsync(
          `UPDATE foundational_rule_settings SET sort_order = ? WHERE rule_id = ?`,
          pos, ruleId,
        );
      } catch {}
    }
    await db.execAsync('PRAGMA user_version = 11');
  }

  if (version < 12) {
    // Drops the FK on transactions.applied_rule_id so synthetic foundational
    // rule IDs ('foundational:<id>') can be persisted alongside real rules.id
    // values. SQLite can't ALTER a FK constraint, so we recreate the table
    // (mirrors the migration-006 pattern). Safe to retry: drops any leftover
    // transactions_new from a previous partial run, and only copies/drops the
    // original transactions table if it still exists.
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      await db.execAsync('DROP TABLE IF EXISTS transactions_new');

      await db.execAsync(`
        CREATE TABLE transactions_new (
          id                    TEXT PRIMARY KEY,
          account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date                  TEXT NOT NULL,
          amount_cents          INTEGER NOT NULL,
          description           TEXT NOT NULL,
          original_description  TEXT NOT NULL,
          is_pending            INTEGER NOT NULL DEFAULT 0,
          dropped_at            INTEGER DEFAULT NULL,
          import_batch_id       TEXT NOT NULL REFERENCES import_batches(id),
          created_at            INTEGER NOT NULL,
          category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
          category_set_manually INTEGER NOT NULL DEFAULT 0,
          applied_rule_id       TEXT
        )
      `);

      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='transactions'`,
      );
      if (row && row.n > 0) {
        await db.execAsync(`
          INSERT INTO transactions_new
            (id, account_id, date, amount_cents, description, original_description,
             is_pending, dropped_at, import_batch_id, created_at,
             category_id, category_set_manually, applied_rule_id)
          SELECT
             id, account_id, date, amount_cents, description, original_description,
             is_pending, dropped_at, import_batch_id, created_at,
             category_id, category_set_manually, applied_rule_id
          FROM transactions
        `);
        await db.execAsync(`DROP TABLE transactions`);
      }
      await db.execAsync(`ALTER TABLE transactions_new RENAME TO transactions`);
      await db.execAsync(`DROP INDEX IF EXISTS idx_tx_account_date`);
      await db.execAsync(`DROP INDEX IF EXISTS idx_tx_date`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions (account_id, date DESC)`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tx_date         ON transactions (date DESC)`);

      // Backfill applied_rule_id for transactions that pre-fix code categorized
      // via a foundational rule but stored NULL (because the FK rejected the
      // synthetic id). Without this, existing users see "Applied 0 times" on
      // foundational rules until they re-import.
      const settings = await db.getAllAsync<{
        account_id: string; rule_id: string; category_id: string | null;
        enabled: number; created_at: number;
      }>(
        `SELECT * FROM foundational_rule_settings WHERE enabled = 1 AND category_id IS NOT NULL`,
      );
      if (settings.length > 0) {
        // Dynamic imports avoid the load-order cycle at module init.
        const { FOUNDATIONAL_RULES } = await import('../domain/foundational-rules');
        const { applyRulesToTransactions } = await import('../domain/rules-engine');

        const rulesByAccount = new Map<string, any[]>();
        for (const s of settings) {
          const fr = FOUNDATIONAL_RULES.find(r => r.id === s.rule_id);
          if (!fr || !s.category_id) continue;
          const rule = {
            id:          `foundational:${fr.id}`,
            account_id:  s.account_id,
            category_id: s.category_id,
            match_type:  fr.conditions[0].match_type,
            match_text:  fr.conditions[0].match_text,
            logic:       fr.logic as 'AND' | 'OR',
            conditions:  fr.conditions,
            priority:    9999,
            created_at:  s.created_at,
          };
          const list = rulesByAccount.get(s.account_id) ?? [];
          list.push(rule);
          rulesByAccount.set(s.account_id, list);
        }

        for (const [accountId, rules] of rulesByAccount) {
          const txs = await db.getAllAsync<{
            id: string; description: string; amount_cents: number; category_set_manually: number;
          }>(
            `SELECT id, description, amount_cents, category_set_manually
             FROM transactions
             WHERE account_id = ?
               AND category_id IS NOT NULL
               AND category_set_manually = 0
               AND applied_rule_id IS NULL`,
            accountId,
          );
          if (txs.length === 0) continue;
          const assignments = applyRulesToTransactions(txs, rules);
          for (const a of assignments) {
            await db.runAsync(
              `UPDATE transactions SET applied_rule_id = ? WHERE id = ?`,
              a.ruleId, a.transactionId,
            );
          }
        }
      }

      await db.execAsync('PRAGMA user_version = 12');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  }

  if (version < 13) {
    try {
      await db.execAsync('PRAGMA foreign_keys = OFF');
      // Add exclude_from_totals flag to categories.
      // Transactions in excluded categories are still tracked but not counted
      // in income/expense/net totals — they appear in a separate summary row.
      await db.execAsync(
        `ALTER TABLE categories ADD COLUMN exclude_from_totals INTEGER NOT NULL DEFAULT 0`,
      );
      await db.execAsync('PRAGMA user_version = 13');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  }

  _db = db;
  return db;
}

