import { createTestDb, TestDb } from '../helpers/db';

async function setupAccountWithCategoryAndRule(t: TestDb) {
  await t.queries.insertAccount({
    id: 'acc', name: 'Test', type: 'checking',
    csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 1,
  });
  await t.queries.insertImportBatch({
    id: 'b', account_id: 'acc', filename: null, imported_at: Date.now(),
    rows_total: 0, rows_inserted: 0, rows_skipped_duplicate: 0,
    rows_cleared: 0, rows_dropped: 0,
  });
  await t.queries.insertCategory({ id: 'cat-food', name: 'Food', color: '#aaa', emoji: null, description: null });
  await t.queries.insertRule({
    id: 'rule-coffee', account_id: 'acc', category_id: 'cat-food',
    match_type: 'contains', match_text: 'starbucks',
    logic: 'AND', conditions: [{ match_type: 'contains', match_text: 'starbucks' }],
    priority: 100,
  });
}

async function insertTx(
  t: TestDb,
  id: string,
  description: string,
  amount = -500,
  manual = 0,
): Promise<void> {
  await t.db.runAsync(
    `INSERT INTO transactions
       (id, account_id, date, amount_cents, description, original_description,
        is_pending, dropped_at, import_batch_id, created_at,
        category_id, category_set_manually, applied_rule_id)
     VALUES (?, 'acc', '2026-01-15', ?, ?, ?, 0, NULL, 'b', ?, NULL, ?, NULL)`,
    id, amount, description, description.toUpperCase(), Date.now(), manual,
  );
}

describe('rule application', () => {
  it('persists a foundational:* rule ID literally (regression for v4.2.0 fix)', async () => {
    const t = await createTestDb();
    await setupAccountWithCategoryAndRule(t);
    await insertTx(t, 't1', 'mcdonalds');

    await t.queries.bulkSetTransactionCategories([
      { transactionId: 't1', categoryId: 'cat-food', ruleId: 'foundational:food-dining' },
    ]);

    const tx = await t.db.getFirstAsync<{ applied_rule_id: string; category_id: string }>(
      `SELECT applied_rule_id, category_id FROM transactions WHERE id = ?`, 't1',
    );
    expect(tx?.applied_rule_id).toBe('foundational:food-dining');
    expect(tx?.category_id).toBe('cat-food');
  });

  it('counts foundational rule applications via getRuleAppliedCounts', async () => {
    const t = await createTestDb();
    await setupAccountWithCategoryAndRule(t);
    await insertTx(t, 't1', 'mcdonalds');
    await insertTx(t, 't2', 'starbucks');
    await insertTx(t, 't3', 'taco bell');

    await t.queries.bulkSetTransactionCategories([
      { transactionId: 't1', categoryId: 'cat-food', ruleId: 'foundational:food-dining' },
      { transactionId: 't2', categoryId: 'cat-food', ruleId: 'rule-coffee' },
      { transactionId: 't3', categoryId: 'cat-food', ruleId: 'foundational:food-dining' },
    ]);

    const counts = await t.queries.getRuleAppliedCounts('acc');
    expect(counts['foundational:food-dining']).toBe(2);
    expect(counts['rule-coffee']).toBe(1);
  });

  it('skips manually-categorized rows during bulk auto-apply', async () => {
    const t = await createTestDb();
    await setupAccountWithCategoryAndRule(t);
    await insertTx(t, 't1', 'starbucks #1', -500, 0);
    await insertTx(t, 't2', 'starbucks #2', -500, 1); // manual

    await t.queries.bulkSetTransactionCategories([
      { transactionId: 't1', categoryId: 'cat-food', ruleId: 'rule-coffee' },
      { transactionId: 't2', categoryId: 'cat-food', ruleId: 'rule-coffee' },
    ]);

    const t1 = await t.db.getFirstAsync<{ applied_rule_id: string; category_id: string }>(
      `SELECT applied_rule_id, category_id FROM transactions WHERE id = 't1'`,
    );
    const t2 = await t.db.getFirstAsync<{ applied_rule_id: string | null; category_id: string | null }>(
      `SELECT applied_rule_id, category_id FROM transactions WHERE id = 't2'`,
    );
    expect(t1?.applied_rule_id).toBe('rule-coffee');
    expect(t2?.applied_rule_id).toBeNull();
    expect(t2?.category_id).toBeNull();
  });

  it('clears applied_rule_id on every matching transaction when a user rule is deleted', async () => {
    const t = await createTestDb();
    await setupAccountWithCategoryAndRule(t);
    await insertTx(t, 't1', 'starbucks #1');
    await insertTx(t, 't2', 'starbucks #2');
    await t.queries.bulkSetTransactionCategories([
      { transactionId: 't1', categoryId: 'cat-food', ruleId: 'rule-coffee' },
      { transactionId: 't2', categoryId: 'cat-food', ruleId: 'rule-coffee' },
    ]);

    // Sanity: both transactions reference the rule
    const before = await t.db.getAllAsync<{ id: string; applied_rule_id: string }>(
      `SELECT id, applied_rule_id FROM transactions ORDER BY id`,
    );
    expect(before.map(b => b.applied_rule_id)).toEqual(['rule-coffee', 'rule-coffee']);

    await t.queries.deleteRule('rule-coffee');

    const after = await t.db.getAllAsync<{ id: string; applied_rule_id: string | null }>(
      `SELECT id, applied_rule_id FROM transactions ORDER BY id`,
    );
    expect(after.map(a => a.applied_rule_id)).toEqual([null, null]);
    const ruleStill = await t.db.getFirstAsync('SELECT id FROM rules WHERE id = ?', 'rule-coffee');
    expect(ruleStill).toBeNull();
  });

  it('autoApplyAllRules runs across multiple accounts and returns the total', async () => {
    const t = await createTestDb();
    // Two accounts, each with its own rule and a few uncategorized transactions
    for (const accId of ['acc-1', 'acc-2']) {
      await t.queries.insertAccount({
        id: accId, name: accId, type: 'checking',
        csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 0,
      });
      await t.queries.insertImportBatch({
        id: `${accId}-b`, account_id: accId, filename: null, imported_at: Date.now(),
        rows_total: 0, rows_inserted: 0, rows_skipped_duplicate: 0,
        rows_cleared: 0, rows_dropped: 0,
      });
    }
    await t.queries.insertCategory({ id: 'cat-food', name: 'Food', color: '#aaa', emoji: null, description: null });
    await t.queries.insertRule({
      id: 'rule-1', account_id: 'acc-1', category_id: 'cat-food',
      match_type: 'contains', match_text: 'starbucks',
      logic: 'AND', conditions: [{ match_type: 'contains', match_text: 'starbucks' }],
      priority: 100,
    });
    await t.queries.insertRule({
      id: 'rule-2', account_id: 'acc-2', category_id: 'cat-food',
      match_type: 'contains', match_text: 'starbucks',
      logic: 'AND', conditions: [{ match_type: 'contains', match_text: 'starbucks' }],
      priority: 100,
    });

    // 2 matching rows per account
    for (const accId of ['acc-1', 'acc-2']) {
      for (const i of [1, 2]) {
        await t.db.runAsync(
          `INSERT INTO transactions
             (id, account_id, date, amount_cents, description, original_description,
              is_pending, dropped_at, import_batch_id, created_at,
              category_id, category_set_manually, applied_rule_id)
           VALUES (?, ?, '2026-01-15', -500, 'starbucks', 'STARBUCKS', 0, NULL, ?, ?, NULL, 0, NULL)`,
          `${accId}-t${i}`, accId, `${accId}-b`, Date.now(),
        );
      }
    }

    const total = await t.rulesEngine.autoApplyAllRules();
    expect(total).toBe(4);

    const counts1 = await t.queries.getRuleAppliedCounts('acc-1');
    const counts2 = await t.queries.getRuleAppliedCounts('acc-2');
    expect(counts1['rule-1']).toBe(2);
    expect(counts2['rule-2']).toBe(2);
  });
});
