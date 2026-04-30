import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { getDb } from './client';

export const BACKUP_PATH      = (FileSystem.documentDirectory ?? '') + 'slo-n-ready-backup.json';
// Tiny sidecar with just the metadata needed by the home-screen restore banner.
// Avoids parsing the (potentially multi-MB) backup JSON on every app launch.
export const BACKUP_META_PATH = (FileSystem.documentDirectory ?? '') + 'slo-n-ready-backup.meta.json';

interface BackupMeta {
  version:           number;
  exported_at:       number;
  account_count:     number;
  transaction_count: number;
}

async function writeBackupMeta(meta: BackupMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(BACKUP_META_PATH, JSON.stringify(meta));
  } catch {
    // Sidecar failure should never block a backup; getBackupInfo falls back
    // to reading the full file if the sidecar is missing or corrupt.
  }
}

export interface BackupData {
  version:                    number;
  exported_at:                number;
  accounts:                   any[];
  import_batches:             any[];
  transactions:               any[];
  categories:                 any[];
  rules:                      any[];
  budgets:                    any[];
  // v4.0 additions (optional so v3 backups still parse cleanly)
  foundational_rule_settings?: any[];
  app_preferences?:            any[];
}

export interface BackupInfo {
  exists:            boolean;
  exported_at:       number | null;
  account_count:     number;
  transaction_count: number;
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const empty: BackupInfo = { exists: false, exported_at: null, account_count: 0, transaction_count: 0 };
  // Fast path: read the small sidecar (written by writeBackup / restoreFromData).
  try {
    const metaInfo = await FileSystem.getInfoAsync(BACKUP_META_PATH);
    if (metaInfo.exists) {
      const meta: BackupMeta = JSON.parse(await FileSystem.readAsStringAsync(BACKUP_META_PATH));
      return {
        exists:            true,
        exported_at:       meta.exported_at ?? null,
        account_count:     meta.account_count ?? 0,
        transaction_count: meta.transaction_count ?? 0,
      };
    }
  } catch {
    // Fall through to legacy path on parse error.
  }
  // Legacy fallback: backups written before the sidecar existed. Parse the full
  // file once; subsequent writes will produce a sidecar so this path is rare.
  try {
    const info = await FileSystem.getInfoAsync(BACKUP_PATH);
    if (!info.exists) return empty;
    const data: BackupData = JSON.parse(await FileSystem.readAsStringAsync(BACKUP_PATH));
    return {
      exists:            true,
      exported_at:       data.exported_at ?? null,
      account_count:     data.accounts?.length ?? 0,
      transaction_count: data.transactions?.length ?? 0,
    };
  } catch {
    return empty;
  }
}

// Snapshots every backup-tracked table for the given db connection. Each query is
// guarded so a missing table (e.g. app_preferences before migration 10) returns []
// instead of throwing. This is the single source of truth used by both writeBackup
// and the pre-migration snapshot in client.ts — when a new table is added, only
// this function needs updating.
export async function snapshotAllTables(db: SQLite.SQLiteDatabase): Promise<BackupData> {
  const safe = async (sql: string): Promise<any[]> => {
    try { return await db.getAllAsync<any>(sql); } catch { return []; }
  };
  const [
    accounts, import_batches, transactions, categories, rules, budgets,
    foundational_rule_settings, app_preferences,
  ] = await Promise.all([
    safe('SELECT * FROM accounts ORDER BY created_at ASC'),
    safe('SELECT * FROM import_batches ORDER BY imported_at ASC'),
    safe('SELECT * FROM transactions ORDER BY created_at ASC'),
    safe('SELECT * FROM categories ORDER BY created_at ASC'),
    safe('SELECT * FROM rules ORDER BY priority ASC'),
    safe('SELECT * FROM budgets ORDER BY account_id, category_id, month'),
    safe('SELECT * FROM foundational_rule_settings ORDER BY account_id, rule_id'),
    safe('SELECT * FROM app_preferences ORDER BY key'),
  ]);
  return {
    version:                    4,
    exported_at:                Date.now(),
    accounts,
    import_batches,
    transactions,
    categories,
    rules,
    budgets,
    foundational_rule_settings,
    app_preferences,
  };
}

// IMPORTANT: snapshotAllTables and restoreFromData must always handle the same set
// of tables. If you add a table to one, add it to the other in the same edit.
export async function writeBackup(): Promise<void> {
  const db = await getDb();
  const data = await snapshotAllTables(db);
  await FileSystem.writeAsStringAsync(BACKUP_PATH, JSON.stringify(data));
  await writeBackupMeta({
    version:           data.version,
    exported_at:       data.exported_at,
    account_count:     data.accounts.length,
    transaction_count: data.transactions.length,
  });
}

export function writeBackupSafe(): void {
  writeBackup().catch(e => console.warn('[backup] auto-save failed:', e));
}

export async function readBackupFromPath(uri: string): Promise<BackupData | null> {
  try {
    const text = await FileSystem.readAsStringAsync(uri);
    const data = JSON.parse(text);
    // Accept v1–v4 backups (v4 adds foundational_rule_settings + app_preferences)
    if (![1, 2, 3, 4].includes(data.version) || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
      return null;
    }
    return data as BackupData;
  } catch {
    return null;
  }
}

export async function restoreFromData(data: BackupData): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // Delete in FK-safe order (children before parents)
    await db.execAsync('DELETE FROM foundational_rule_settings');
    await db.execAsync('DELETE FROM app_preferences');
    await db.execAsync('DELETE FROM transactions');
    await db.execAsync('DELETE FROM import_batches');
    await db.execAsync('DELETE FROM budgets');
    await db.execAsync('DELETE FROM rules');
    await db.execAsync('DELETE FROM categories');
    await db.execAsync('DELETE FROM accounts');

    for (const a of data.accounts) {
      await db.runAsync(
        'INSERT OR REPLACE INTO accounts (id, name, type, csv_format, column_config, created_at, suggest_rules) VALUES (?, ?, ?, ?, ?, ?, ?)',
        a.id, a.name, a.type, a.csv_format, a.column_config ?? null, a.created_at, a.suggest_rules ?? 1,
      );
    }

    for (const c of (data.categories ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO categories (id, name, color, emoji, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        c.id, c.name, c.color, c.emoji ?? null, c.description ?? null, c.created_at,
      );
    }

    for (const r of (data.rules ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO rules (id, account_id, category_id, match_type, match_text, priority, created_at, logic, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        r.id, r.account_id, r.category_id, r.match_type, r.match_text, r.priority, r.created_at,
        r.logic ?? 'AND', r.conditions ?? '[]',
      );
    }

    for (const b of (data.budgets ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO budgets (account_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)',
        b.account_id, b.category_id, b.month, b.amount_cents,
      );
    }

    for (const b of (data.import_batches ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO import_batches (id, account_id, filename, imported_at, rows_total, rows_inserted, rows_skipped_duplicate, rows_cleared, rows_dropped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        b.id, b.account_id, b.filename ?? null, b.imported_at,
        b.rows_total, b.rows_inserted, b.rows_skipped_duplicate,
        b.rows_cleared ?? 0, b.rows_dropped ?? 0,
      );
    }

    for (const t of data.transactions) {
      await db.runAsync(
        'INSERT OR REPLACE INTO transactions (id, account_id, date, amount_cents, description, original_description, is_pending, dropped_at, import_batch_id, created_at, category_id, category_set_manually, applied_rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        t.id, t.account_id, t.date, t.amount_cents, t.description,
        t.original_description, t.is_pending, t.dropped_at ?? null,
        t.import_batch_id, t.created_at,
        t.category_id ?? null, t.category_set_manually ?? 0, t.applied_rule_id ?? null,
      );
    }

    // v4.0 tables — optional in backup (absent in v3 and earlier backups)
    for (const s of (data.foundational_rule_settings ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO foundational_rule_settings (account_id, rule_id, category_id, enabled, created_at) VALUES (?, ?, ?, ?, ?)',
        s.account_id, s.rule_id, s.category_id ?? null, s.enabled ?? 0, s.created_at,
      );
    }

    for (const p of (data.app_preferences ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)',
        p.key, p.value, p.updated_at,
      );
    }
  });
  // Refresh the sidecar so getBackupInfo reflects the restored DB without
  // having to parse the original backup file on the next home-screen load.
  await writeBackupMeta({
    version:           data.version,
    exported_at:       data.exported_at,
    account_count:     data.accounts.length,
    transaction_count: data.transactions.length,
  });
}

/**
 * Permanently deletes every row from every table.
 * Used by the "Wipe All Data" feature in the Backup screen.
 * Runs inside a single transaction in FK-safe order (children before parents).
 * Does NOT delete app_preferences — so the v4 welcome sheet won't re-appear
 * if the user decides to start fresh.
 */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM foundational_rule_settings');
    await db.execAsync('DELETE FROM transactions');
    await db.execAsync('DELETE FROM import_batches');
    await db.execAsync('DELETE FROM budgets');
    await db.execAsync('DELETE FROM rules');
    await db.execAsync('DELETE FROM categories');
    await db.execAsync('DELETE FROM accounts');
  });
}
