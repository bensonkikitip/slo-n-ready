import { createTestDb, TestDb } from '../helpers/db';

const BASE = {
  name: 'Checking', type: 'checking' as const,
  csv_format: 'boa_checking_v1' as const,
  column_config: '{}', suggest_rules: 1,
};

describe('accounts', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); });

  it('getAllAccounts returns inserted accounts ordered by created_at', async () => {
    await t.queries.insertAccount({ id: 'a1', ...BASE, created_at: 1000 });
    await t.queries.insertAccount({ id: 'a2', name: 'Credit', type: 'credit_card', csv_format: 'citi_cc_v1', column_config: '{}', suggest_rules: 0, created_at: 2000 });
    const accounts = await t.queries.getAllAccounts();
    expect(accounts.map(a => a.id)).toEqual(['a1', 'a2']);
    expect(accounts[1].type).toBe('credit_card');
  });

  it('updateAccount persists only the changed fields; others stay intact', async () => {
    await t.queries.insertAccount({ id: 'acc', ...BASE });
    await t.queries.updateAccount('acc', { name: 'New Name' });
    const [acc] = await t.queries.getAllAccounts();
    expect(acc.name).toBe('New Name');
    expect(acc.type).toBe('checking');          // unchanged
    expect(acc.csv_format).toBe('boa_checking_v1'); // unchanged
  });

  it('updateAccountSuggestRules toggles the flag', async () => {
    await t.queries.insertAccount({ id: 'acc', ...BASE });
    await t.queries.updateAccountSuggestRules('acc', 0);
    expect((await t.queries.getAllAccounts())[0].suggest_rules).toBe(0);
    await t.queries.updateAccountSuggestRules('acc', 1);
    expect((await t.queries.getAllAccounts())[0].suggest_rules).toBe(1);
  });

  it('deleteAccount cascades to all child rows; sibling account and its data survive', async () => {
    await t.queries.insertAccount({ id: 'del', ...BASE });
    await t.queries.insertAccount({ id: 'keep', ...BASE });
    await t.queries.insertCategory({ id: 'cat', name: 'Food', color: '#aaa', emoji: null, description: null });

    // Seed every child table for 'del'
    await t.queries.insertImportBatch({
      id: 'b-del', account_id: 'del', filename: null, imported_at: 1000,
      rows_total: 1, rows_inserted: 1, rows_skipped_duplicate: 0, rows_cleared: 0, rows_dropped: 0,
    });
    await t.db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount_cents, description, original_description,
          is_pending, dropped_at, import_batch_id, created_at, category_id, category_set_manually, applied_rule_id)
       VALUES ('tx', 'del', '2026-01-01', -100, 'a', 'A', 0, NULL, 'b-del', 1000, NULL, 0, NULL)`,
    );
    await t.queries.insertRule({
      id: 'r', account_id: 'del', category_id: 'cat',
      match_type: 'contains', match_text: 'a',
      logic: 'AND', conditions: [{ match_type: 'contains', match_text: 'a' }], priority: 100,
    });
    await t.queries.setBudget('del', 'cat', '2026-01', 10000);
    await t.queries.upsertFoundationalRuleSetting('del', 'food-dining', 'cat', 1);

    // Sibling batch — must survive the delete
    await t.queries.insertImportBatch({
      id: 'b-keep', account_id: 'keep', filename: null, imported_at: 1000,
      rows_total: 0, rows_inserted: 0, rows_skipped_duplicate: 0, rows_cleared: 0, rows_dropped: 0,
    });

    await t.queries.deleteAccount('del');

    expect((await t.queries.getAllAccounts()).map(a => a.id)).toEqual(['keep']);
    expect(await t.db.getAllAsync(`SELECT 1 FROM import_batches WHERE account_id = 'del'`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT 1 FROM transactions WHERE account_id = 'del'`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT 1 FROM rules WHERE account_id = 'del'`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT 1 FROM budgets WHERE account_id = 'del'`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT 1 FROM foundational_rule_settings WHERE account_id = 'del'`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT 1 FROM import_batches WHERE account_id = 'keep'`)).toHaveLength(1);
  });

  it('parseColumnConfig falls back to the default config when column_config is invalid JSON', async () => {
    await t.queries.insertAccount({ id: 'acc', ...BASE, column_config: 'not-json' });
    const [acc] = await t.queries.getAllAccounts();
    const config = t.queries.parseColumnConfig(acc);
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });
});
