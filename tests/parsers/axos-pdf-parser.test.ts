import { parseAxosPdf } from '../../src/parsers/pdf-parsers/axos-pdf-parser';
import { AXOS_STATEMENT_ITEMS, AXOS_EXPECTED } from '../fixtures/pdf/axos-fixture';

describe('parseAxosPdf', () => {
  const result = parseAxosPdf(AXOS_STATEMENT_ITEMS);

  describe('transaction extraction', () => {
    it('parses the correct number of transactions', () => {
      expect(result.rows.length).toBe(AXOS_EXPECTED.totalTransactions);
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

    it('year is inferred as 2026 from statement period header', () => {
      for (const row of result.rows) {
        expect(row.dateIso.startsWith('2026-')).toBe(true);
      }
    });
  });

  describe('transaction signs', () => {
    it('credit transactions are positive (income)', () => {
      const businessChecking = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('business') ||
        r.originalDescription.toLowerCase().includes('from:')
      );
      expect(businessChecking).toBeDefined();
      expect(businessChecking!.amountCents).toBe(AXOS_EXPECTED.businessCheckingCents);
    });

    it('debit transactions are negative (expense)', () => {
      const alliant = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('alliant')
      );
      expect(alliant).toBeDefined();
      expect(alliant!.amountCents).toBe(AXOS_EXPECTED.alliantCents);
    });

    it('EPAY CHASE debit is negative', () => {
      const epay = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('epay') ||
        r.originalDescription.toLowerCase().includes('chase')
      );
      expect(epay).toBeDefined();
      expect(epay!.amountCents).toBe(AXOS_EXPECTED.epayChaseCents);
    });

    it('AXOS BANK credit is positive', () => {
      const axosBank = result.rows.find(r =>
        r.originalDescription.toLowerCase().includes('axos')
      );
      expect(axosBank).toBeDefined();
      expect(axosBank!.amountCents).toBe(AXOS_EXPECTED.axosBankCents);
    });
  });

  describe('multi-line description handling', () => {
    it('merges continuation rows into the parent transaction', () => {
      // TX1: "From: Business Checking *0849" + continuation "To: Checking *0204"
      const tx1 = result.rows.find(r => r.originalDescription.toLowerCase().includes('business'));
      expect(tx1).toBeDefined();
      // Should include words from continuation row
      expect(tx1!.originalDescription.toLowerCase()).toContain('to:');
    });

    it('merges ALLIANT continuation row', () => {
      const tx2 = result.rows.find(r => r.originalDescription.toLowerCase().includes('alliant'));
      expect(tx2).toBeDefined();
      expect(tx2!.originalDescription.toLowerCase()).toContain('web');
    });
  });

  describe('noise filtering', () => {
    it('skips the Ending Balance row (no transaction for that amount)', () => {
      // Ending balance $822.83 should not appear as a transaction
      const endBal = result.rows.find(r => Math.abs(r.amountCents) === 82_283);
      expect(endBal).toBeUndefined();
    });

    it('skips the statement period header (no spurious 2026 date-only rows)', () => {
      // "01/01/2026" in the header should not produce a transaction
      expect(result.rows.length).toBe(AXOS_EXPECTED.totalTransactions);
    });

    it('has no skipped candidates for well-formed fixture input', () => {
      expect(result.skippedCandidates.length).toBe(0);
    });
  });

  describe('summary and diff reconciliation', () => {
    it('extracts a summary', () => {
      expect(result.summary).toBeDefined();
    });

    it('summary label contains statement dates', () => {
      expect(result.summary!.label).toContain('2026');
    });

    it('summary expectedTotals has credits and debits', () => {
      expect(result.summary!.expectedTotals['credits']).toBe(AXOS_EXPECTED.totalCreditsCents);
      expect(result.summary!.expectedTotals['debits']).toBe(AXOS_EXPECTED.totalDebitsCents);
    });

    it('diffCents is zero when all transactions are parsed', () => {
      expect(result.summary!.diffCents).toBe(AXOS_EXPECTED.diffCents);
    });
  });
});
