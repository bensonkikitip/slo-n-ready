import { applyRulesToTransactions } from '../../src/domain/rules-engine';
import { Rule } from '../../src/db/queries';

function makeRule(overrides: Partial<Rule> & Pick<Rule, 'match_type' | 'match_text' | 'category_id'>): Rule {
  return {
    id: 'rule-1',
    account_id: 'acct-1',
    priority: 1,
    created_at: 0,
    ...overrides,
  };
}

function makeTx(id: string, description: string, manually = 0) {
  return { id, description, category_set_manually: manually };
}

describe('applyRulesToTransactions', () => {
  describe('match_type: contains', () => {
    const rule = makeRule({ match_type: 'contains', match_text: 'whole foods', category_id: 'cat-grocery' });

    it('matches when text is in the middle of description', () => {
      const result = applyRulesToTransactions(
        [makeTx('tx-1', 'PURCHASE WHOLE FOODS MARKET')],
        [rule],
      );
      expect(result).toEqual([{ transactionId: 'tx-1', categoryId: 'cat-grocery', ruleId: 'rule-1' }]);
    });

    it('does not match when text is absent', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'NETFLIX.COM')], [rule]);
      expect(result).toHaveLength(0);
    });
  });

  describe('match_type: starts_with', () => {
    const rule = makeRule({ match_type: 'starts_with', match_text: 'amazon', category_id: 'cat-shopping' });

    it('matches when description starts with the text', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'AMAZON PRIME *ABC123')], [rule]);
      expect(result).toHaveLength(1);
    });

    it('does not match when text is in the middle', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'PURCHASE AMAZON')], [rule]);
      expect(result).toHaveLength(0);
    });
  });

  describe('match_type: ends_with', () => {
    const rule = makeRule({ match_type: 'ends_with', match_text: 'github.com', category_id: 'cat-tech' });

    it('matches when description ends with the text', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'SUBSCRIPTION GITHUB.COM')], [rule]);
      expect(result).toHaveLength(1);
    });

    it('does not match when text is at the start', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'GITHUB.COM SUBSCRIPTION')], [rule]);
      expect(result).toHaveLength(0);
    });
  });

  describe('match_type: equals', () => {
    const rule = makeRule({ match_type: 'equals', match_text: 'uber', category_id: 'cat-transport' });

    it('matches exact description', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'UBER')], [rule]);
      expect(result).toHaveLength(1);
    });

    it('does not match partial description', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'UBER EATS')], [rule]);
      expect(result).toHaveLength(0);
    });
  });

  describe('case-insensitivity', () => {
    it('matches regardless of description casing', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'starbucks', category_id: 'cat-coffee' });
      const txns = [
        makeTx('a', 'STARBUCKS #1234'),
        makeTx('b', 'Starbucks Coffee'),
        makeTx('c', 'starbucks'),
      ];
      const result = applyRulesToTransactions(txns, [rule]);
      expect(result.map(r => r.transactionId)).toEqual(['a', 'b', 'c']);
    });

    it('matches regardless of rule text casing', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'STARBUCKS', category_id: 'cat-coffee' });
      const result = applyRulesToTransactions([makeTx('tx-1', 'starbucks latte')], [rule]);
      expect(result).toHaveLength(1);
    });
  });

  describe('first-match-wins (priority order)', () => {
    it('applies the first matching rule and skips the rest', () => {
      const rules = [
        makeRule({ id: 'rule-1', match_type: 'contains', match_text: 'amazon', category_id: 'cat-a', priority: 1 }),
        makeRule({ id: 'rule-2', match_type: 'contains', match_text: 'amazon prime', category_id: 'cat-b', priority: 2 }),
      ];
      const result = applyRulesToTransactions([makeTx('tx-1', 'AMAZON PRIME VIDEO')], rules);
      expect(result).toHaveLength(1);
      expect(result[0].categoryId).toBe('cat-a');
      expect(result[0].ruleId).toBe('rule-1');
    });
  });

  describe('skipping manually-categorized transactions', () => {
    it('skips transactions where category_set_manually = 1', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'netflix', category_id: 'cat-ent' });
      const result = applyRulesToTransactions(
        [makeTx('tx-1', 'NETFLIX.COM', 1)],
        [rule],
      );
      expect(result).toHaveLength(0);
    });

    it('still assigns transactions where category_set_manually = 0', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'netflix', category_id: 'cat-ent' });
      const result = applyRulesToTransactions(
        [makeTx('tx-1', 'NETFLIX.COM', 0)],
        [rule],
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no rules provided', () => {
      const result = applyRulesToTransactions([makeTx('tx-1', 'STARBUCKS')], []);
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no transactions provided', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'starbucks', category_id: 'cat-coffee' });
      const result = applyRulesToTransactions([], [rule]);
      expect(result).toHaveLength(0);
    });

    it('only assigns transactions that match; skips non-matching ones', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'starbucks', category_id: 'cat-coffee' });
      const txns = [
        makeTx('tx-match', 'STARBUCKS #5'),
        makeTx('tx-no-match', 'MCDONALDS #12'),
      ];
      const result = applyRulesToTransactions(txns, [rule]);
      expect(result).toHaveLength(1);
      expect(result[0].transactionId).toBe('tx-match');
    });

    it('each transaction gets at most one assignment', () => {
      const rules = [
        makeRule({ id: 'r1', match_type: 'contains', match_text: 'food', category_id: 'cat-food', priority: 1 }),
        makeRule({ id: 'r2', match_type: 'contains', match_text: 'whole', category_id: 'cat-grocery', priority: 2 }),
      ];
      const result = applyRulesToTransactions([makeTx('tx-1', 'WHOLE FOODS MARKET')], rules);
      expect(result).toHaveLength(1);
    });
  });

  describe('defensive guards (v2.3.1 bug fixes)', () => {
    it('skips rules with empty match_text — an empty string matches everything via .includes()', () => {
      // Regression: a rule with blank match_text would match every transaction because
      // "anything".includes("") === true. The fix guards with `if (!pattern) continue`.
      const emptyRule = makeRule({ match_type: 'contains', match_text: '', category_id: 'cat-bad' });
      const result = applyRulesToTransactions(
        [makeTx('tx-1', 'FREEBIRDS GOLETA CA')],
        [emptyRule],
      );
      expect(result).toHaveLength(0);
    });

    it('skips rules with whitespace-only match_text (trimmed to empty)', () => {
      const wsRule = makeRule({ match_type: 'starts_with', match_text: '   ', category_id: 'cat-bad' });
      // "   ".toLowerCase() is "   ", which is non-empty, so startsWith("   ") won't match a normal description
      // But if we had trimmed in the engine — this tests the empty-after-trim case isn't a false positive either
      const result = applyRulesToTransactions(
        [makeTx('tx-1', 'FREEBIRDS GOLETA CA')],
        [wsRule],
      );
      expect(result).toHaveLength(0);
    });

    it('a valid amazon rule does NOT match an unrelated merchant (FREEBIRDS)', () => {
      // Regression case: confirms the Amazon "contains amazon" rule cannot match
      // "FREEBIRDS GOLETA CA". The source of the bug was the picker re-selecting the
      // same category and converting rule-assigned (⚙) to manually-assigned (✎), not
      // a matching fault.
      const amazonRule = makeRule({
        match_type: 'contains', match_text: 'amazon', category_id: 'cat-amazon',
      });
      const result = applyRulesToTransactions(
        [makeTx('tx-freebirds', 'FREEBIRDS GOLETA CA')],
        [amazonRule],
      );
      expect(result).toHaveLength(0);
    });

    it('handles null/undefined description without throwing', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'amazon', category_id: 'cat-amazon' });
      // description may be null if imported from a malformed CSV row
      const txWithNullDesc = { id: 'tx-1', description: null as unknown as string, category_set_manually: 0 };
      expect(() => applyRulesToTransactions([txWithNullDesc], [rule])).not.toThrow();
      expect(applyRulesToTransactions([txWithNullDesc], [rule])).toHaveLength(0);
    });
  });
});
