/**
 * Tests for transaction edit/delete mutations and cross-import dedup query.
 *
 * Covers:
 *   updateTransaction
 *     - updates date, amount_cents, description in place (id unchanged)
 *     - preserves category_id, category_set_manually, applied_rule_id
 *   hardDeleteTransaction
 *     - removes the row from the DB entirely
 *   softDropTransaction
 *     - sets dropped_at; row no longer appears in active-filter queries
 *   findCrossImportDuplicates
 *     - returns pairs from different batches with same amount, date ±1 day
 *     - does NOT return pairs from the same batch
 *     - does NOT match when amount differs
 *     - does NOT match when dates are >1 day apart
 *     - does NOT return dropped rows as candidates
 */

import { createTestDb } from '../helpers/db';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeAccount(queries: any, id = 'acct-1') {
  await queries.insertAccount({
    id, name: 'Test', type: 'checking', csv_format: 'boa_checking_v1',
    column_config: '{}', suggest_rules: 1,
  });
  return id;
}

async function makeCategory(queries: any, id = 'cat-food') {
  await queries.bulkInsertCategories([{
    id, name: 'Food', color: '#D4956A', emoji: '🍔', description: '', exclude_from_totals: 0,
  }]);
  return id;
}

async function insertImportedTx(
  db: any,
  opts: { txId: string; accountId: string; batchId: string; date: string; amountCents: number; desc: string },
) {
  await db.runAsync(
    `INSERT OR IGNORE INTO import_batches
       (id, account_id, filename, imported_at, rows_total, rows_inserted,
        rows_skipped_duplicate, rows_cleared, rows_dropped)
     VALUES (?, ?, 'statement.csv', ?, 1, 1, 0, 0, 0)`,
    opts.batchId, opts.accountId, Date.now(),
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO transactions
       (id, account_id, date, amount_cents, description, original_description,
        is_pending, dropped_at, import_batch_id, created_at, source_is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0)`,
    opts.txId, opts.accountId, opts.date, opts.amountCents,
    opts.desc, opts.desc, opts.batchId, Date.now(),
  );
}

// ── updateTransaction ─────────────────────────────────────────────────────────

describe('updateTransaction', () => {
  it('updates date, amount_cents, and description while keeping the same id', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-1', accountId, batchId: 'batch-1',
      date: '2026-01-15', amountCents: -1000, desc: 'OLD DESC',
    });

    await queries.updateTransaction('tx-1', {
      dateIso: '2026-01-20',
      amountCents: -2000,
      description: 'NEW DESC',
    });

    const row = await db.getFirstAsync<any>(`SELECT * FROM transactions WHERE id = 'tx-1'`);
    expect(row).not.toBeNull();
    expect(row.id).toBe('tx-1');
    expect(row.date).toBe('2026-01-20');
    expect(row.amount_cents).toBe(-2000);
    expect(row.description).toBe('NEW DESC');
  });

  it('preserves category_id and category_set_manually', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    const catId = await makeCategory(queries);
    await insertImportedTx(db, {
      txId: 'tx-1', accountId, batchId: 'batch-1',
      date: '2026-01-15', amountCents: -1000, desc: 'DESC',
    });
    await db.runAsync(
      `UPDATE transactions SET category_id = ?, category_set_manually = 1 WHERE id = 'tx-1'`,
      catId,
    );

    await queries.updateTransaction('tx-1', {
      dateIso: '2026-01-16',
      amountCents: -500,
      description: 'UPDATED',
    });

    const row = await db.getFirstAsync<any>(`SELECT * FROM transactions WHERE id = 'tx-1'`);
    expect(row.category_id).toBe(catId);
    expect(row.category_set_manually).toBe(1);
  });
});

// ── hardDeleteTransaction ─────────────────────────────────────────────────────

describe('hardDeleteTransaction', () => {
  it('removes the row entirely from the database', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    // Use insertManualTransaction so source_is_manual = 1
    const txId = await queries.insertManualTransaction(accountId, '2026-01-15', -500, 'Coffee');
    if (!txId) throw new Error('insertManualTransaction returned null');

    await queries.hardDeleteTransaction(txId);

    const row = await db.getFirstAsync<any>(`SELECT * FROM transactions WHERE id = ?`, txId);
    expect(row).toBeNull();
  });

  it('does not affect other rows', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    const tx1 = await queries.insertManualTransaction(accountId, '2026-01-15', -500, 'Coffee');
    const tx2 = await queries.insertManualTransaction(accountId, '2026-01-16', -800, 'Lunch');
    if (!tx1 || !tx2) throw new Error('insertManualTransaction returned null');

    await queries.hardDeleteTransaction(tx1);

    const remaining = await db.getFirstAsync<any>(`SELECT * FROM transactions WHERE id = ?`, tx2);
    expect(remaining).not.toBeNull();
  });
});

// ── softDropTransaction ───────────────────────────────────────────────────────

describe('softDropTransaction', () => {
  it('sets dropped_at to a non-null timestamp', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-imp', accountId, batchId: 'batch-1',
      date: '2026-01-15', amountCents: -1000, desc: 'Import TX',
    });

    await queries.softDropTransaction('tx-imp');

    const row = await db.getFirstAsync<any>(`SELECT * FROM transactions WHERE id = 'tx-imp'`);
    expect(row.dropped_at).not.toBeNull();
    expect(typeof row.dropped_at).toBe('number');
  });

  it('dropped row is excluded from account summary (active-filter queries)', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-imp', accountId, batchId: 'batch-1',
      date: '2026-01-15', amountCents: -1000, desc: 'Import TX',
    });
    // Before drop: summary shows the expense
    const before = await queries.getAccountSummaryForMonth(accountId, '2026-01');
    expect(before.expense_cents).toBe(-1000);

    await queries.softDropTransaction('tx-imp');

    // After drop: excluded from summary
    const after = await queries.getAccountSummaryForMonth(accountId, '2026-01');
    expect(after.expense_cents).toBe(0);
  });
});

// ── findCrossImportDuplicates ─────────────────────────────────────────────────

describe('findCrossImportDuplicates', () => {
  it('finds a pair across different batches with same amount and same date', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-old', accountId, batchId: 'batch-csv',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS CSV',
    });
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1500, desc: 'Starbucks Coffee',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].newTx.id).toBe('tx-new');
    expect(pairs[0].existingTx.id).toBe('tx-old');
  });

  it('finds a pair when dates are 1 day apart', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-old', accountId, batchId: 'batch-csv',
      date: '2026-01-14', amountCents: -2000, desc: 'AMAZON',
    });
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -2000, desc: 'Amazon.com',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(1);
  });

  it('does NOT find a pair when dates are 2 days apart', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-old', accountId, batchId: 'batch-csv',
      date: '2026-01-13', amountCents: -2000, desc: 'AMAZON',
    });
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -2000, desc: 'Amazon.com',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(0);
  });

  it('does NOT find a pair when amounts differ', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-old', accountId, batchId: 'batch-csv',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS',
    });
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1600, desc: 'Starbucks',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(0);
  });

  it('does NOT return pairs from within the same batch', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-a', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS A',
    });
    await insertImportedTx(db, {
      txId: 'tx-b', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS B',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(0);
  });

  it('does NOT return dropped rows as existing candidates', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    await insertImportedTx(db, {
      txId: 'tx-old', accountId, batchId: 'batch-csv',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS CSV',
    });
    // Mark old tx as dropped
    await db.runAsync(`UPDATE transactions SET dropped_at = ? WHERE id = 'tx-old'`, Date.now());
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1500, desc: 'Starbucks',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(0);
  });

  it('collapses multiple existing matches to one pair per new tx (GROUP BY)', async () => {
    const { db, queries } = await createTestDb();
    const accountId = await makeAccount(queries);
    // Two old rows with same amount/date from two different old batches
    await insertImportedTx(db, {
      txId: 'tx-old-a', accountId, batchId: 'batch-csv-1',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS A',
    });
    await insertImportedTx(db, {
      txId: 'tx-old-b', accountId, batchId: 'batch-csv-2',
      date: '2026-01-15', amountCents: -1500, desc: 'STARBUCKS B',
    });
    await insertImportedTx(db, {
      txId: 'tx-new', accountId, batchId: 'batch-pdf',
      date: '2026-01-15', amountCents: -1500, desc: 'Starbucks',
    });

    const pairs = await queries.findCrossImportDuplicates(accountId, 'batch-pdf');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].newTx.id).toBe('tx-new');
  });
});
