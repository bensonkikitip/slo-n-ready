import { createTestDb } from './db';

describe('createTestDb', () => {
  it('returns a fully-migrated in-memory DB at LATEST_DB_VERSION', async () => {
    const { db } = await createTestDb();
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(13);
  });

  it('isolates state between calls', async () => {
    const a = await createTestDb();
    await a.queries.insertAccount({
      id: 'acc-1',
      name: 'Iso A',
      type: 'checking',
      csv_format: 'boa_checking_v1',
      column_config: '{}',
      suggest_rules: 1,
    });
    expect((await a.queries.getAllAccounts()).length).toBe(1);

    const b = await createTestDb();
    expect((await b.queries.getAllAccounts()).length).toBe(0);
  });

  it('enforces foreign keys', async () => {
    const { db } = await createTestDb();
    await expect(
      db.runAsync(
        `INSERT INTO transactions
         (id, account_id, date, amount_cents, description, original_description,
          import_batch_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'tx-1', 'no-such-account', '2026-01-01', -100, 'x', 'x', 'no-batch', Date.now(),
      ),
    ).rejects.toThrow();
  });
});
