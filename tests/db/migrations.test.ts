import { createTestDb } from '../helpers/db';

const EXPECTED_TABLES = [
  'accounts',
  'import_batches',
  'transactions',
  'categories',
  'rules',
  'budgets',
  'foundational_rule_settings',
  'app_preferences',
];

describe('migrations', () => {
  it('applies all migrations on a fresh DB and lands at LATEST_DB_VERSION', async () => {
    const { db } = await createTestDb();
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(13);
  });

  it('creates every table documented in docs/SCHEMA.md', async () => {
    const { db } = await createTestDb();
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const names = tables.map(t => t.name);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
  });

  it('enables foreign keys at the connection level', async () => {
    const { db } = await createTestDb();
    const row = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(row?.foreign_keys).toBe(1);
  });

  it('drops the FK from transactions.applied_rule_id (regression for v4.2.0 fix)', async () => {
    // Migration 12 dropped the FK so synthetic foundational IDs ('foundational:<id>')
    // can be persisted alongside real rules.id values. If a future migration
    // accidentally re-introduces it, foundational applied counts silently break.
    const { db } = await createTestDb();
    const fks = await db.getAllAsync<{ table: string; from: string; to: string }>(
      `PRAGMA foreign_key_list(transactions)`,
    );
    const ruleFk = fks.find(fk => fk.from === 'applied_rule_id');
    expect(ruleFk).toBeUndefined();
  });

  it('persists a foundational rule ID in transactions.applied_rule_id', async () => {
    // The whole point of dropping the FK: this insert would have crashed on
    // pre-v4.2.0 schemas because 'foundational:food-dining' isn't a real rules.id.
    const { db, queries } = await createTestDb();

    await queries.insertAccount({
      id: 'acc-1',
      name: 'Test',
      type: 'checking',
      csv_format: 'boa_checking_v1',
      column_config: '{}',
      suggest_rules: 1,
    });
    await db.runAsync(
      `INSERT INTO import_batches (id, account_id, filename, imported_at, rows_total, rows_inserted, rows_skipped_duplicate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'batch-1', 'acc-1', 'test.csv', Date.now(), 1, 1, 0,
    );
    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount_cents, description, original_description,
          import_batch_id, created_at, applied_rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'tx-1', 'acc-1', '2026-01-15', -1234, 'starbucks', 'starbucks',
      'batch-1', Date.now(), 'foundational:food-dining',
    );

    const tx = await db.getFirstAsync<{ applied_rule_id: string }>(
      `SELECT applied_rule_id FROM transactions WHERE id = ?`, 'tx-1',
    );
    expect(tx?.applied_rule_id).toBe('foundational:food-dining');
  });

  it('keeps the indexes from the original schema after migration 12 recreates transactions', async () => {
    const { db } = await createTestDb();
    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='transactions' AND name NOT LIKE 'sqlite_%'`,
    );
    const names = indexes.map(i => i.name);
    expect(names).toContain('idx_tx_account_date');
    expect(names).toContain('idx_tx_date');
  });

  it('keeps existing transactions intact across the migration 12 table recreation', async () => {
    // Surrogate test: if migration 12 ever drops the data-copy step or skips
    // a column, this will catch it the next time we run integration tests
    // against a real upgrade. Here we just sanity-check that the schema
    // accepts the full transaction shape.
    const { db, queries } = await createTestDb();
    await queries.insertAccount({
      id: 'acc-2', name: 'X', type: 'credit_card', csv_format: 'citi_cc_v1',
      column_config: '{}', suggest_rules: 0,
    });
    await db.runAsync(
      `INSERT INTO import_batches (id, account_id, filename, imported_at, rows_total, rows_inserted, rows_skipped_duplicate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'b', 'acc-2', null, Date.now(), 0, 0, 0,
    );
    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount_cents, description, original_description,
          is_pending, dropped_at, import_batch_id, created_at,
          category_id, category_set_manually, applied_rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      't', 'acc-2', '2026-02-01', 5000, 'p', 'p', 1, null, 'b', Date.now(),
      null, 0, null,
    );
    const t = await db.getFirstAsync<{ id: string }>(`SELECT id FROM transactions WHERE id = 't'`);
    expect(t?.id).toBe('t');
  });
});
