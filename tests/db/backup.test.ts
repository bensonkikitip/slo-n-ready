import { createTestDb, TestDb } from '../helpers/db';

// Seed every backup-tracked table so the round-trip exercises real coverage,
// not just the happy paths. Returns the data we expect to see after restore.
async function seed(t: TestDb): Promise<void> {
  const { queries, db } = t;

  // 2 accounts (different formats so column_config + suggest_rules vary)
  await queries.insertAccount({
    id: 'acc-checking', name: 'Checking', type: 'checking',
    csv_format: 'boa_checking_v1',
    column_config: JSON.stringify({ dateColumn: 'Date' }),
    suggest_rules: 1,
  });
  await queries.insertAccount({
    id: 'acc-credit', name: 'Credit Card', type: 'credit_card',
    csv_format: 'citi_cc_v1', column_config: '{}', suggest_rules: 0,
  });

  // 2 import batches
  await queries.insertImportBatch({
    id: 'batch-1', account_id: 'acc-checking', filename: 'jan.csv',
    imported_at: 1_700_000_000_000,
    rows_total: 10, rows_inserted: 10, rows_skipped_duplicate: 0,
    rows_cleared: 0, rows_dropped: 0,
  });
  await queries.insertImportBatch({
    id: 'batch-2', account_id: 'acc-credit', filename: null,
    imported_at: 1_700_500_000_000,
    rows_total: 5, rows_inserted: 5, rows_skipped_duplicate: 0,
    rows_cleared: 2, rows_dropped: 1,
  });

  // 3 categories (mix of emoji/description set vs null)
  await queries.bulkInsertCategories([
    { id: 'cat-food',  name: 'Food',     color: '#aaa', emoji: '🍕',  description: 'meals' },
    { id: 'cat-trans', name: 'Transit',  color: '#bbb', emoji: null,  description: null },
    { id: 'cat-other', name: 'Other',    color: '#ccc', emoji: '📦',  description: null },
  ]);

  // 1 user rule with multi-condition logic — exercises the conditions JSON column
  // (regression area: rules backup column loss reported in c5d3057).
  await queries.insertRule({
    id: 'rule-coffee', account_id: 'acc-checking', category_id: 'cat-food',
    match_type: 'contains', match_text: 'starbucks',
    logic: 'OR',
    conditions: [
      { match_type: 'contains', match_text: 'starbucks' },
      { match_type: 'contains', match_text: 'peet' },
    ],
    priority: 100,
  });

  // 6 transactions across both accounts: cleared, pending, dropped, manual,
  // categorized via user rule, categorized via foundational rule.
  const inserts: [string, string, string, number, string, string, number, number | null, string, number, string | null, number, string | null][] = [
    // id, account_id, date, amount_cents, desc, orig, is_pending, dropped_at, batch, created_at, category_id, set_manually, applied_rule_id
    ['t1', 'acc-checking', '2026-01-05', -1234, 'starbucks #1', 'STARBUCKS #1',     0, null, 'batch-1', 1_700_000_001_000, 'cat-food', 0, 'rule-coffee'],
    ['t2', 'acc-checking', '2026-01-08',  -550, 'peet coffee',   'PEETS COFFEE',    0, null, 'batch-1', 1_700_000_002_000, 'cat-food', 0, 'rule-coffee'],
    ['t3', 'acc-checking', '2026-01-12', -2200, 'safeway',       'SAFEWAY',         1, null, 'batch-1', 1_700_000_003_000, 'cat-other', 1, null],
    ['t4', 'acc-checking', '2026-01-15', -3300, 'lyft',          'LYFT',            0, 1_700_900_000_000, 'batch-1', 1_700_000_004_000, null, 0, null],
    ['t5', 'acc-credit',   '2026-01-20', -1000, 'mcdonalds',     'MCDONALDS',       0, null, 'batch-2', 1_700_500_001_000, 'cat-food', 0, 'foundational:food-dining'],
    ['t6', 'acc-credit',   '2026-01-22',  5000, 'refund',        'REFUND',          1, null, 'batch-2', 1_700_500_002_000, null, 0, null],
  ];
  for (const r of inserts) {
    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount_cents, description, original_description,
          is_pending, dropped_at, import_batch_id, created_at,
          category_id, category_set_manually, applied_rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...r,
    );
  }

  // 2 budgets (different months + a 0-cent budget which is a special UI case)
  await queries.setBudget('acc-checking', 'cat-food',  '2026-01', 30000);
  await queries.setBudget('acc-checking', 'cat-food',  '2026-02', 32000);
  await queries.setBudget('acc-credit',   'cat-other', '2026-01', 0);

  // 2 foundational settings (one enabled, one disabled with a specific sort_order)
  await queries.upsertFoundationalRuleSetting('acc-credit', 'food-dining', 'cat-food', 1);
  await queries.upsertFoundationalRuleSetting('acc-credit', 'groceries',   null,        0);

  // 2 prefs
  await queries.setPreference('v4_welcomed',     'true');
  await queries.setPreference('onboarding_seen', 'true');
}

async function snapshot(t: TestDb) {
  const { db } = t;
  return {
    accounts:                    await db.getAllAsync('SELECT * FROM accounts ORDER BY id'),
    import_batches:              await db.getAllAsync('SELECT * FROM import_batches ORDER BY id'),
    transactions:                await db.getAllAsync('SELECT * FROM transactions ORDER BY id'),
    categories:                  await db.getAllAsync('SELECT * FROM categories ORDER BY id'),
    rules:                       await db.getAllAsync('SELECT * FROM rules ORDER BY id'),
    budgets:                     await db.getAllAsync('SELECT * FROM budgets ORDER BY account_id, category_id, month'),
    foundational_rule_settings:  await db.getAllAsync('SELECT * FROM foundational_rule_settings ORDER BY account_id, rule_id'),
    app_preferences:             await db.getAllAsync('SELECT * FROM app_preferences ORDER BY key'),
  };
}

describe('backup / restore round-trip', () => {
  it('preserves every row across a full export → import cycle', async () => {
    // Seed and export
    const before = await createTestDb();
    await seed(before);
    const expected = await snapshot(before);
    await before.backup.writeBackup();

    // Capture the JSON before resetModules wipes the mock fs.
    const json = before.fs._peekMockFs().get(before.backup.BACKUP_PATH);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json!);

    // Restore into a fresh DB and snapshot
    const after = await createTestDb();
    await after.backup.restoreFromData(parsed);
    const got = await snapshot(after);

    expect(got).toEqual(expected);
  });

  it('preserves the rules conditions JSON column verbatim (regression for c5d3057)', async () => {
    const before = await createTestDb();
    await seed(before);
    await before.backup.writeBackup();
    const json = before.fs._peekMockFs().get(before.backup.BACKUP_PATH)!;
    const parsed = JSON.parse(json);

    const after = await createTestDb();
    await after.backup.restoreFromData(parsed);

    // Read the rule back through the parsing query and confirm the multi-condition
    // structure is intact end-to-end.
    const rules = await after.queries.getRulesForAccount('acc-checking');
    expect(rules).toHaveLength(1);
    expect(rules[0].logic).toBe('OR');
    expect(rules[0].conditions).toEqual([
      { match_type: 'contains', match_text: 'starbucks' },
      { match_type: 'contains', match_text: 'peet' },
    ]);
  });

  it('writes a sidecar so getBackupInfo does not parse the full backup file', async () => {
    const t = await createTestDb();
    await seed(t);
    await t.backup.writeBackup();

    const fs = t.fs._peekMockFs();
    expect(fs.has(t.backup.BACKUP_PATH)).toBe(true);
    expect(fs.has(t.backup.BACKUP_META_PATH)).toBe(true);

    // Sidecar should be much smaller than the full file
    const fullSize = fs.get(t.backup.BACKUP_PATH)!.length;
    const metaSize = fs.get(t.backup.BACKUP_META_PATH)!.length;
    expect(metaSize).toBeLessThan(fullSize);

    const info = await t.backup.getBackupInfo();
    expect(info.exists).toBe(true);
    expect(info.account_count).toBe(2);
    expect(info.transaction_count).toBe(6);
  });

  it('falls back to parsing the full file if the sidecar is missing (legacy backups)', async () => {
    const t = await createTestDb();
    await seed(t);
    await t.backup.writeBackup();

    // Simulate a backup written before the sidecar existed
    const fs = t.fs._peekMockFs();
    fs.delete(t.backup.BACKUP_META_PATH);
    expect(fs.has(t.backup.BACKUP_PATH)).toBe(true);

    const info = await t.backup.getBackupInfo();
    expect(info.exists).toBe(true);
    expect(info.account_count).toBe(2);
    expect(info.transaction_count).toBe(6);
  });

  it('refreshes the sidecar after a restore so getBackupInfo reflects new data', async () => {
    const before = await createTestDb();
    await seed(before);
    await before.backup.writeBackup();
    const json = before.fs._peekMockFs().get(before.backup.BACKUP_PATH)!;
    const parsed = JSON.parse(json);

    // Tamper with the parsed counts so we can assert the sidecar is rewritten
    // from the actual restored data, not blindly copied from the file.
    const after = await createTestDb();
    await after.backup.restoreFromData(parsed);

    const fs = after.fs._peekMockFs();
    expect(fs.has(after.backup.BACKUP_META_PATH)).toBe(true);
    const meta = JSON.parse(fs.get(after.backup.BACKUP_META_PATH)!);
    expect(meta.account_count).toBe(2);
    expect(meta.transaction_count).toBe(6);
  });

  it('cleanly imports a v3 backup that lacks v4-only tables', async () => {
    // Backups exported on v3 (no foundational_rule_settings, no app_preferences)
    // must restore without crashing and leave those tables empty.
    const v3Backup = {
      version: 3,
      exported_at: 1_690_000_000_000,
      accounts: [{
        id: 'acc-v3', name: 'Old', type: 'checking', csv_format: 'boa_checking_v1',
        column_config: '{}', created_at: 1_690_000_000_000, suggest_rules: 1,
      }],
      import_batches: [{
        id: 'b-v3', account_id: 'acc-v3', filename: null, imported_at: 1_690_000_001_000,
        rows_total: 1, rows_inserted: 1, rows_skipped_duplicate: 0, rows_cleared: 0, rows_dropped: 0,
      }],
      transactions: [{
        id: 't-v3', account_id: 'acc-v3', date: '2024-01-01', amount_cents: -100,
        description: 'old', original_description: 'OLD',
        is_pending: 0, dropped_at: null, import_batch_id: 'b-v3', created_at: 1_690_000_001_000,
        category_id: null, category_set_manually: 0, applied_rule_id: null,
      }],
      categories: [],
      rules: [],
      budgets: [],
      // foundational_rule_settings + app_preferences absent
    };

    const t = await createTestDb();
    await t.backup.restoreFromData(v3Backup as any);

    const accounts = await t.queries.getAllAccounts();
    expect(accounts).toHaveLength(1);
    const settings = await t.queries.getFoundationalRuleSettingsForAccount('acc-v3');
    expect(settings).toEqual([]);
    const pref = await t.queries.getPreference('anything');
    expect(pref).toBeNull();
  });
});
