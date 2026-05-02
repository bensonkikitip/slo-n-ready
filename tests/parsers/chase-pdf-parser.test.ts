import { parseChasePdf } from '../../src/parsers/pdf-parsers/chase-pdf-parser';
import { CHASE_STATEMENT_ITEMS, CHASE_EXPECTED } from '../fixtures/pdf/chase-fixture';

describe('parseChasePdf', () => {
  const result = parseChasePdf(CHASE_STATEMENT_ITEMS);

  describe('transaction extraction', () => {
    it('parses the correct number of transactions', () => {
      expect(result.rows.length).toBe(CHASE_EXPECTED.totalTransactions);
    });

    it('produces only non-pending transactions', () => {
      expect(result.rows.every(r => !r.isPending)).toBe(true);
    });

    it('all rows have valid ISO dates', () => {
      for (const row of result.rows) {
        expect(row.dateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('all rows have non-zero amounts', () => {
      for (const row of result.rows) {
        expect(row.amountCents).not.toBe(0);
      }
    });

    it('year is inferred as 2026 from page 1 header', () => {
      for (const row of result.rows) {
        expect(row.dateIso.startsWith('2026-')).toBe(true);
      }
    });
  });

  describe('transaction signs', () => {
    it('purchase transactions are negative (expense)', () => {
      const starbucks = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('starbucks'),
      );
      expect(starbucks).toBeDefined();
      expect(starbucks!.amountCents).toBe(CHASE_EXPECTED.starbucksCents);
    });

    it('second purchase is also negative', () => {
      const amazon = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('amazon'),
      );
      expect(amazon).toBeDefined();
      expect(amazon!.amountCents).toBe(CHASE_EXPECTED.amazonCents);
    });

    it('payment transaction is positive (income)', () => {
      const payment = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('autopay') ||
        r.originalDescription.toLowerCase().includes('payment'),
      );
      expect(payment).toBeDefined();
      expect(payment!.amountCents).toBe(CHASE_EXPECTED.paymentCents);
    });
  });

  describe('multi-line description handling', () => {
    it('merges continuation rows into the parent transaction', () => {
      const tx1 = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('starbucks'),
      );
      expect(tx1).toBeDefined();
      expect(tx1!.originalDescription.toLowerCase()).toContain('new york');
    });
  });

  describe('doubled-char noise filtering', () => {
    it('does not include doubled-char noise rows as transactions', () => {
      const noise = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('mmaa') ||
        r.originalDescription.toLowerCase().includes('yyoo'),
      );
      expect(noise).toBeUndefined();
    });

    it('has no skipped candidates for well-formed fixture input', () => {
      expect(result.skippedCandidates.length).toBe(0);
    });
  });

  describe('summary and diff reconciliation', () => {
    it('extracts a summary', () => {
      expect(result.summary).toBeDefined();
    });

    it('summary label contains 2026', () => {
      expect(result.summary!.label).toContain('2026');
    });

    it('summary expectedTotals has purchases', () => {
      expect(result.summary!.expectedTotals['purchases']).toBe(CHASE_EXPECTED.totalPurchasesCents);
    });

    it('diffCents is zero when all transactions are parsed', () => {
      expect(result.summary!.diffCents).toBe(CHASE_EXPECTED.diffCents);
    });
  });
});
