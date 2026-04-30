import { getDb } from '../client';
import { ColumnConfig, DEFAULT_CONFIGS } from '../../parsers/column-config';

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
