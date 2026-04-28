import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from './client';

export const BACKUP_PATH = (FileSystem.documentDirectory ?? '') + 'slo-n-ready-backup.json';

export interface BackupData {
  version:        number;
  exported_at:    number;
  accounts:       any[];
  import_batches: any[];
  transactions:   any[];
  categories:     any[];
  rules:          any[];
}

export interface BackupInfo {
  exists:            boolean;
  exported_at:       number | null;
  account_count:     number;
  transaction_count: number;
}

export async function getBackupInfo(): Promise<BackupInfo> {
  try {
    const info = await FileSystem.getInfoAsync(BACKUP_PATH);
    if (!info.exists) return { exists: false, exported_at: null, account_count: 0, transaction_count: 0 };
    const text = await FileSystem.readAsStringAsync(BACKUP_PATH);
    const data: BackupData = JSON.parse(text);
    return {
      exists:            true,
      exported_at:       data.exported_at ?? null,
      account_count:     data.accounts?.length ?? 0,
      transaction_count: data.transactions?.length ?? 0,
    };
  } catch {
    return { exists: false, exported_at: null, account_count: 0, transaction_count: 0 };
  }
}

export async function writeBackup(): Promise<void> {
  try {
    const db = await getDb();
    const [accounts, import_batches, transactions, categories, rules] = await Promise.all([
      db.getAllAsync<any>('SELECT * FROM accounts ORDER BY created_at ASC'),
      db.getAllAsync<any>('SELECT * FROM import_batches ORDER BY imported_at ASC'),
      db.getAllAsync<any>('SELECT * FROM transactions ORDER BY created_at ASC'),
      db.getAllAsync<any>('SELECT * FROM categories ORDER BY created_at ASC'),
      db.getAllAsync<any>('SELECT * FROM rules ORDER BY priority ASC'),
    ]);
    const data: BackupData = {
      version:        2,
      exported_at:    Date.now(),
      accounts,
      import_batches,
      transactions,
      categories,
      rules,
    };
    await FileSystem.writeAsStringAsync(BACKUP_PATH, JSON.stringify(data));
  } catch {
    // Backup failures are silent — don't interrupt user flow
  }
}

export async function readBackupFromPath(uri: string): Promise<BackupData | null> {
  try {
    const text = await FileSystem.readAsStringAsync(uri);
    const data = JSON.parse(text);
    // Accept both v1 (no categories) and v2 backups
    if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
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
    await db.execAsync('DELETE FROM transactions');
    await db.execAsync('DELETE FROM import_batches');
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
        'INSERT OR REPLACE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)',
        c.id, c.name, c.color, c.created_at,
      );
    }

    for (const r of (data.rules ?? [])) {
      await db.runAsync(
        'INSERT OR REPLACE INTO rules (id, account_id, category_id, match_type, match_text, priority, created_at, logic, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        r.id, r.account_id, r.category_id, r.match_type, r.match_text, r.priority, r.created_at,
        r.logic ?? 'AND', r.conditions ?? '[]',
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
  });
}
