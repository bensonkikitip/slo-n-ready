/**
 * Tests for exclude_from_totals category flag in summary queries.
 *
 * Covers: getAccountSummaryForMonth, getAllAccountsSummaryForMonth,
 *         getAccountSummaryForYear, getAllAccountsSummaryForYear,
 *         getAccountSummary (all-time).
 */

import { createTestDb, TestDb } from '../helpers/db';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function setupBase(t: TestDb) {
  await t.queries.insertAccount({
    id: 'acc', name: 'Checking', type: 'checking',
    csv_format: 'boa_checking_v1', column_config: '{}', suggest_rules: 0,
  });
  await t.queries.insertImportBatch({
    id: 'b', account_id: 'acc', filename: null, imported_at: 1000,
    rows_total: 0, rows_inserted: 0, rows_skipped_duplicate: 0,
    rows_cleared: 0, rows_dropped: 0,
  });
  // Regular category
  await t.queries.insertCategory({
    id: 'food', name: 'Food', color: '#aaa', emoji: null, description: null,
    exclude_from_totals: 0,
  });
  // Excluded category
  await t.queries.insertCategory({
    id: 'xfer', name: 'Transfers', color: '#bbb', emoji: null, description: null,
    exclude_from_totals: 1,
  });
}

async function insertTx(
  t: TestDb,
  id: string,
  amount: number,
  categoryId: string | null,
  date = '2026-03-15',
) {
  await t.db.runAsync(
    `INSERT INTO transactions
       (id, account_id, date, amount_cents, description, original_description,
        is_pending, dropped_at, import_batch_id, created_at, category_id, category_set_manually, applied_rule_id)
     VALUES (?, 'acc', ?, ?, 'test', 'TEST', 0, NULL, 'b', 1000, ?, 0, NULL)`,
    id, date, amount, categoryId,
  );
}

// ─── getAccountSummaryForMonth ────────────────────────────────────────────────

describe('getAccountSummaryForMonth — exclude_from_totals', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); await setupBase(t); });

  it('excluded transaction does not count toward expense_cents', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer');   // $500 excluded
    await insertTx(t, 'tx2', -20000, 'food');   // $200 regular
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.expense_cents).toBe(-20000);
  });

  it('excluded transaction amount goes into excluded_cents', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer');
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.excluded_cents).toBe(-50000);
  });

  it('excluded transaction does not affect net_cents', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer');
    await insertTx(t, 'tx2',  80000, 'food');   // income
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.net_cents).toBe(80000);            // only non-excluded
    expect(s.excluded_cents).toBe(-50000);
  });

  it('uncategorized transaction still counts as income/expense (not excluded)', async () => {
    await insertTx(t, 'tx1', -30000, null);
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.expense_cents).toBe(-30000);
    expect(s.excluded_cents).toBe(0);
  });

  it('excluded_cents is 0 when no excluded categories used', async () => {
    await insertTx(t, 'tx1', -20000, 'food');
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.excluded_cents).toBe(0);
  });

  it('mixed month: regular income, regular expense, excluded outflow all bucketed correctly', async () => {
    await insertTx(t, 'inc',  100000, 'food');  // $1000 income
    await insertTx(t, 'exp',  -40000, 'food');  // $400 expense
    await insertTx(t, 'xfr',  -60000, 'xfer'); // $600 excluded
    const s = await t.queries.getAccountSummaryForMonth('acc', '2026-03');
    expect(s.income_cents).toBe(100000);
    expect(s.expense_cents).toBe(-40000);
    expect(s.net_cents).toBe(60000);
    expect(s.excluded_cents).toBe(-60000);
  });
});

// ─── getAllAccountsSummaryForMonth ────────────────────────────────────────────

describe('getAllAccountsSummaryForMonth — exclude_from_totals', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); await setupBase(t); });

  it('excluded transaction in all-accounts summary goes to excluded_cents only', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer');
    await insertTx(t, 'tx2', -20000, 'food');
    const s = await t.queries.getAllAccountsSummaryForMonth('2026-03');
    expect(s.expense_cents).toBe(-20000);
    expect(s.excluded_cents).toBe(-50000);
  });
});

// ─── getAccountSummaryForYear ─────────────────────────────────────────────────

describe('getAccountSummaryForYear — exclude_from_totals', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); await setupBase(t); });

  it('excluded transaction does not appear in year expense_cents', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer', '2026-06-01');
    await insertTx(t, 'tx2', -20000, 'food', '2026-07-01');
    const s = await t.queries.getAccountSummaryForYear('acc', '2026');
    expect(s.expense_cents).toBe(-20000);
    expect(s.excluded_cents).toBe(-50000);
  });
});

// ─── getAllAccountsSummaryForYear ─────────────────────────────────────────────

describe('getAllAccountsSummaryForYear — exclude_from_totals', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); await setupBase(t); });

  it('excluded transaction in all-accounts year summary goes to excluded_cents only', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer', '2026-06-01');
    const s = await t.queries.getAllAccountsSummaryForYear('2026');
    expect(s.excluded_cents).toBe(-50000);
    expect(s.expense_cents).toBe(0);
  });
});

// ─── getAccountSummary (all-time) ─────────────────────────────────────────────

describe('getAccountSummary (all-time) — exclude_from_totals', () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); await setupBase(t); });

  it('excluded transaction does not appear in all-time expense_cents', async () => {
    await insertTx(t, 'tx1', -50000, 'xfer');
    const s = await t.queries.getAccountSummary('acc');
    expect(s.expense_cents).toBe(0);
    expect(s.excluded_cents).toBe(-50000);
  });
});
