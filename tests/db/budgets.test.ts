import { createTestDb, TestDb } from '../helpers/db';

async function setup(t: TestDb) {
  await t.queries.insertAccount({
    id: 'acc', name: 'A', type: 'checking', csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 0,
  });
  await t.queries.insertCategory({ id: 'cat-food',   name: 'Food',   color: '#aaa', emoji: null, description: null });
  await t.queries.insertCategory({ id: 'cat-transit', name: 'Transit', color: '#bbb', emoji: null, description: null });
  await t.queries.insertImportBatch({
    id: 'b', account_id: 'acc', filename: null, imported_at: 1000,
    rows_total: 0, rows_inserted: 0, rows_skipped_duplicate: 0, rows_cleared: 0, rows_dropped: 0,
  });
}

describe('budgets', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); });

  it('setBudget inserts a row, then replaces it on a second call', async () => {
    await setup(t);
    await t.queries.setBudget('acc', 'cat-food', '2026-01', 30000);
    await t.queries.setBudget('acc', 'cat-food', '2026-01', 50000);
    const budgets = await t.queries.getBudgetsForAccountYear('acc', '2026');
    expect(budgets).toHaveLength(1);
    expect(budgets[0].amount_cents).toBe(50000);
  });

  it('setBudget with amountCents === 0 deletes the row (the "clear cell" path)', async () => {
    await setup(t);
    await t.queries.setBudget('acc', 'cat-food', '2026-01', 30000);
    await t.queries.setBudget('acc', 'cat-food', '2026-01', 0);
    expect(await t.queries.getBudgetsForAccountYear('acc', '2026')).toHaveLength(0);
  });

  it("getBudgetsForAccountYear returns only that account's rows", async () => {
    await setup(t);
    await t.queries.insertAccount({
      id: 'acc2', name: 'B', type: 'checking', csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 0,
    });
    await t.queries.setBudget('acc',  'cat-food', '2026-01', 10000);
    await t.queries.setBudget('acc2', 'cat-food', '2026-01', 99999);
    const budgets = await t.queries.getBudgetsForAccountYear('acc', '2026');
    expect(budgets).toHaveLength(1);
    expect(budgets[0].amount_cents).toBe(10000);
  });

  it('getActualsByCategoryMonth aggregates by category+month, excluding dropped and uncategorized', async () => {
    await setup(t);

    const tx = (id: string, date: string, amt: number, cat: string | null, dropped = false) =>
      t.db.runAsync(
        `INSERT INTO transactions
           (id, account_id, date, amount_cents, description, original_description,
            is_pending, dropped_at, import_batch_id, created_at, category_id, category_set_manually, applied_rule_id)
         VALUES (?, 'acc', ?, ?, 'x', 'X', 0, ?, 'b', 1000, ?, 0, NULL)`,
        id, date, amt, dropped ? Date.now() : null, cat,
      );

    await tx('t1', '2026-01-05', -1000, 'cat-food');
    await tx('t2', '2026-01-15', -2000, 'cat-food');
    await tx('t3', '2026-02-01',  -500, 'cat-transit');
    await tx('t4', '2026-01-20',  -999, null);            // uncategorized — must be excluded
    await tx('t5', '2026-01-25',  -888, 'cat-food', true); // dropped — must be excluded

    const actuals = await t.queries.getActualsByCategoryMonth('acc', '2026');
    const map = Object.fromEntries(actuals.map(a => [`${a.category_id}|${a.month}`, a.total_cents]));
    expect(map['cat-food|2026-01']).toBe(-3000);   // t1 + t2
    expect(map['cat-transit|2026-02']).toBe(-500); // t3
    expect(Object.keys(map)).toHaveLength(2);       // t4 and t5 not present
  });

  it("replaceBudgetsForYear with categoryId removes only that category's rows; other categories survive", async () => {
    await setup(t);
    await t.queries.setBudget('acc', 'cat-food',    '2026-01', 10000);
    await t.queries.setBudget('acc', 'cat-food',    '2026-02', 20000);
    await t.queries.setBudget('acc', 'cat-transit', '2026-01',  5000);

    // Replace only cat-food rows with a single new row
    await t.queries.replaceBudgetsForYear('acc', '2026', [
      { account_id: 'acc', category_id: 'cat-food', month: '2026-03', amount_cents: 30000 },
    ], 'cat-food');

    const budgets = await t.queries.getBudgetsForAccountYear('acc', '2026');
    const food    = budgets.filter(b => b.category_id === 'cat-food');
    const transit = budgets.filter(b => b.category_id === 'cat-transit');
    expect(food).toHaveLength(1);
    expect(food[0].month).toBe('2026-03');
    expect(transit).toHaveLength(1);       // untouched
    expect(transit[0].amount_cents).toBe(5000);
  });
});
