import { parseBoaCcPdf } from '../../src/parsers/pdf-parsers/boa-cc-pdf-parser';
import { BOA_CC_STATEMENT_ITEMS, BOA_CC_EXPECTED } from '../fixtures/pdf/boa-cc-fixture';

describe('parseBoaCcPdf', () => {
  const result = parseBoaCcPdf(BOA_CC_STATEMENT_ITEMS);

  describe('transaction extraction', () => {
    it('parses the correct number of transactions', () => {
      expect(result.rows.length).toBe(BOA_CC_EXPECTED.totalTransactions);
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

    it('year is inferred as 2025 from statement period on page 2', () => {
      for (const row of result.rows) {
        expect(row.dateIso.startsWith('2025-')).toBe(true);
      }
    });
  });

  describe('transaction signs', () => {
    it('purchase transactions are negative (expense)', () => {
      const wholeFoods = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('whole') ||
        r.originalDescription.toLowerCase().includes('foods'),
      );
      expect(wholeFoods).toBeDefined();
      expect(wholeFoods!.amountCents).toBe(BOA_CC_EXPECTED.wholeFoodsCents);
    });

    it('second purchase is also negative', () => {
      const amazon = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('amazon'),
      );
      expect(amazon).toBeDefined();
      expect(amazon!.amountCents).toBe(BOA_CC_EXPECTED.amazonCents);
    });

    it('payment transaction is positive (income)', () => {
      const payment = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('payment') ||
        r.originalDescription.toLowerCase().includes('received'),
      );
      expect(payment).toBeDefined();
      expect(payment!.amountCents).toBe(BOA_CC_EXPECTED.paymentCents);
    });
  });

  describe('column stripping', () => {
    it('does not include Posting Date values in descriptions', () => {
      // Posting Dates (05/03, 05/07, 05/12) should not appear in any description
      for (const row of result.rows) {
        const desc = row.originalDescription;
        expect(desc).not.toMatch(/05\/0[3-9]/);
      }
    });

    it('does not include Reference Number values in descriptions', () => {
      // Reference numbers (24356789, 98765432, 11223344) should not appear
      for (const row of result.rows) {
        expect(row.originalDescription).not.toContain('24356789');
        expect(row.originalDescription).not.toContain('98765432');
        expect(row.originalDescription).not.toContain('11223344');
      }
    });
  });

  describe('multi-line description handling', () => {
    it('merges continuation rows into the parent transaction', () => {
      const tx1 = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('whole'),
      );
      expect(tx1).toBeDefined();
      expect(tx1!.originalDescription.toLowerCase()).toContain('san francisco');
    });
  });

  describe('noise filtering', () => {
    it('has no skipped candidates for well-formed fixture input', () => {
      expect(result.skippedCandidates.length).toBe(0);
    });
  });

  describe('summary and diff reconciliation', () => {
    it('extracts a summary', () => {
      expect(result.summary).toBeDefined();
    });

    it('summary label contains 2025', () => {
      expect(result.summary!.label).toContain('2025');
    });

    it('summary expectedTotals has purchases', () => {
      expect(result.summary!.expectedTotals['purchases']).toBe(BOA_CC_EXPECTED.totalPurchasesCents);
    });

    it('diffCents is zero when all transactions are parsed', () => {
      expect(result.summary!.diffCents).toBe(BOA_CC_EXPECTED.diffCents);
    });
  });
});
