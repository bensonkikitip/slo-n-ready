import { createTestDb, TestDb } from '../helpers/db';

async function setupAccount(t: TestDb) {
  await t.queries.insertAccount({
    id: 'acc', name: 'A', type: 'checking', csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 0,
  });
}

describe('foundational rule settings', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); });

  it('getFoundationalRuleSettingsForAccount returns empty array for an account with no settings', async () => {
    await setupAccount(t);
    const settings = await t.queries.getFoundationalRuleSettingsForAccount('acc');
    expect(settings).toEqual([]);
  });

  it('upsertFoundationalRuleSetting inserts on first call and updates on second (ON CONFLICT DO UPDATE)', async () => {
    await setupAccount(t);
    await t.queries.insertCategory({ id: 'cat', name: 'Food', color: '#aaa', emoji: null, description: null });

    await t.queries.upsertFoundationalRuleSetting('acc', 'food-dining', 'cat', 1);
    const first = await t.queries.getFoundationalRuleSettingsForAccount('acc');
    expect(first).toHaveLength(1);
    expect(first[0].category_id).toBe('cat');
    expect(first[0].enabled).toBe(1);

    await t.queries.upsertFoundationalRuleSetting('acc', 'food-dining', 'cat', 0);
    const second = await t.queries.getFoundationalRuleSettingsForAccount('acc');
    expect(second).toHaveLength(1);
    expect(second[0].enabled).toBe(0);
  });

  it('getActiveFoundationalRulesAsRules returns only enabled=1 rows with a category_id, shaped as Rule objects', async () => {
    await setupAccount(t);
    await t.queries.insertCategory({ id: 'cat-food',    name: 'Food',     color: '#aaa', emoji: null, description: null });
    await t.queries.insertCategory({ id: 'cat-grocery', name: 'Groceries', color: '#bbb', emoji: null, description: null });

    await t.queries.upsertFoundationalRuleSetting('acc', 'food-dining', 'cat-food',    1); // enabled → returned
    await t.queries.upsertFoundationalRuleSetting('acc', 'groceries',   'cat-grocery', 0); // disabled → NOT returned

    const rules = await t.queries.getActiveFoundationalRulesAsRules('acc');
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('foundational:food-dining');
    expect(rules[0].category_id).toBe('cat-food');
    expect(rules[0].priority).toBe(9999); // always lower priority than user rules
  });

  it('getActiveFoundationalRulesAsRules excludes enabled=1 rules where category_id is null', async () => {
    await setupAccount(t);
    await t.queries.upsertFoundationalRuleSetting('acc', 'food-dining', null, 1);
    const rules = await t.queries.getActiveFoundationalRulesAsRules('acc');
    expect(rules).toHaveLength(0);
  });

  it('reorderFoundationalRules updates sort_order values to match the new ordering', async () => {
    await setupAccount(t);
    await t.queries.bulkUpsertFoundationalRuleSettings('acc', [
      { rule_id: 'food-dining', category_id: null, enabled: 0, sort_order: 0 },
      { rule_id: 'groceries',   category_id: null, enabled: 0, sort_order: 1 },
    ]);

    await t.queries.reorderFoundationalRules('acc', ['groceries', 'food-dining']);

    const settings = await t.queries.getFoundationalRuleSettingsForAccount('acc');
    const order = Object.fromEntries(settings.map(s => [s.rule_id, s.sort_order]));
    expect(order['groceries']).toBe(0);
    expect(order['food-dining']).toBe(1);
  });

  it('bulkUpsertFoundationalRuleSettings persists the given sort_order values', async () => {
    await setupAccount(t);
    await t.queries.bulkUpsertFoundationalRuleSettings('acc', [
      { rule_id: 'groceries',   category_id: null, enabled: 0, sort_order: 5  },
      { rule_id: 'food-dining', category_id: null, enabled: 0, sort_order: 10 },
    ]);
    const settings = await t.queries.getFoundationalRuleSettingsForAccount('acc');
    const order = Object.fromEntries(settings.map(s => [s.rule_id, s.sort_order]));
    expect(order['groceries']).toBe(5);
    expect(order['food-dining']).toBe(10);
  });
});
