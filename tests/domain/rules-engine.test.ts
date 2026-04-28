import { applyRulesToTransactions, txMatchesRulePattern, txMatchesSingleRule } from '../../src/domain/rules-engine';
import { Rule } from '../../src/db/queries';

function makeRule(overrides: Partial<Rule> & Pick<Rule, 'match_type' | 'match_text' | 'category_id'>): Rule {
  return {
    id: 'rule-1',
    account_id: 'acct-1',
    logic: 'AND',
    conditions: [],
    priority: 1,
    created_at: 0,
    ...overrides,
  };
}

function makeTx(id: string, description: string, manually = 0, amount_cents = 0) {
  return { id, description, amount_cents, category_set_manually: manually };
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
      const txWithNullDesc = { id: 'tx-1', description: null as unknown as string, amount_cents: 0, category_set_manually: 0 };
      expect(() => applyRulesToTransactions([txWithNullDesc], [rule])).not.toThrow();
      expect(applyRulesToTransactions([txWithNullDesc], [rule])).toHaveLength(0);
    });
  });
});

describe('txMatchesSingleRule', () => {
  describe('basic matching', () => {
    it('returns true when description matches', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'netflix', category_id: 'cat-ent' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'NETFLIX.COM'), rule)).toBe(true);
    });

    it('returns false when description does not match', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'netflix', category_id: 'cat-ent' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'SPOTIFY PREMIUM'), rule)).toBe(false);
    });
  });

  describe('manually-categorized guard', () => {
    it('returns false for transactions with category_set_manually = 1', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'whole foods', category_id: 'cat-grocery' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'WHOLE FOODS', 1), rule)).toBe(false);
    });

    it('returns true for transactions with category_set_manually = 0', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'whole foods', category_id: 'cat-grocery' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'WHOLE FOODS', 0), rule)).toBe(true);
    });
  });

  describe('amount conditions', () => {
    it('matches amount_eq when cents are equal', () => {
      const rule = makeRule({ match_type: 'amount_eq', match_text: '500', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', '', 0, 500), rule)).toBe(true);
    });

    it('does not match amount_eq when cents differ', () => {
      const rule = makeRule({ match_type: 'amount_eq', match_text: '500', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', '', 0, 501), rule)).toBe(false);
    });

    it('matches amount_lt when tx amount is less', () => {
      const rule = makeRule({ match_type: 'amount_lt', match_text: '1000', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', '', 0, 999), rule)).toBe(true);
      expect(txMatchesSingleRule(makeTx('tx-2', '', 0, 1000), rule)).toBe(false);
    });

    it('matches amount_gt when tx amount is greater', () => {
      const rule = makeRule({ match_type: 'amount_gt', match_text: '1000', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', '', 0, 1001), rule)).toBe(true);
      expect(txMatchesSingleRule(makeTx('tx-2', '', 0, 1000), rule)).toBe(false);
    });
  });

  describe('multi-condition AND logic', () => {
    it('returns true only when all conditions match', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: 'amazon',
        category_id: 'cat-shopping',
        logic: 'AND',
        conditions: [
          { match_type: 'contains', match_text: 'amazon' },
          { match_type: 'contains', match_text: 'prime' },
        ],
      });
      expect(txMatchesSingleRule(makeTx('tx-1', 'AMAZON PRIME VIDEO'), rule)).toBe(true);
      expect(txMatchesSingleRule(makeTx('tx-2', 'AMAZON MARKETPLACE'), rule)).toBe(false);
    });

    it('returns false when only one of two AND conditions matches', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: '',
        category_id: 'cat-x',
        logic: 'AND',
        conditions: [
          { match_type: 'contains', match_text: 'coffee' },
          { match_type: 'contains', match_text: 'starbucks' },
        ],
      });
      expect(txMatchesSingleRule(makeTx('tx-1', 'COFFEE BEAN & TEA'), rule)).toBe(false);
    });
  });

  describe('multi-condition OR logic', () => {
    it('returns true when any condition matches', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: '',
        category_id: 'cat-streaming',
        logic: 'OR',
        conditions: [
          { match_type: 'contains', match_text: 'netflix' },
          { match_type: 'contains', match_text: 'spotify' },
          { match_type: 'contains', match_text: 'hulu' },
        ],
      });
      expect(txMatchesSingleRule(makeTx('tx-1', 'SPOTIFY PREMIUM'), rule)).toBe(true);
      expect(txMatchesSingleRule(makeTx('tx-2', 'HULU LLC'), rule)).toBe(true);
    });

    it('returns false when no OR condition matches', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: '',
        category_id: 'cat-streaming',
        logic: 'OR',
        conditions: [
          { match_type: 'contains', match_text: 'netflix' },
          { match_type: 'contains', match_text: 'spotify' },
        ],
      });
      expect(txMatchesSingleRule(makeTx('tx-1', 'DISNEY PLUS'), rule)).toBe(false);
    });
  });

  describe('legacy fallback (empty conditions array)', () => {
    it('falls back to match_type/match_text when conditions is empty', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: 'starbucks',
        category_id: 'cat-coffee',
        conditions: [],
      });
      expect(txMatchesSingleRule(makeTx('tx-1', 'STARBUCKS #1234'), rule)).toBe(true);
      expect(txMatchesSingleRule(makeTx('tx-2', 'MCDONALDS'), rule)).toBe(false);
    });
  });

  describe('empty match_text guard', () => {
    it('returns false for a contains rule with empty match_text', () => {
      const rule = makeRule({ match_type: 'contains', match_text: '', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'ANY DESCRIPTION'), rule)).toBe(false);
    });
  });

  describe('manually-categorized guard delegates to txMatchesRulePattern', () => {
    it('returns false for category_set_manually = 1 even when pattern matches', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'costco', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'COSTCO WHOLESALE', 1), rule)).toBe(false);
    });

    it('returns true for category_set_manually = 0 when pattern matches', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'costco', category_id: 'cat-x' });
      expect(txMatchesSingleRule(makeTx('tx-1', 'COSTCO WHOLESALE', 0), rule)).toBe(true);
    });
  });
});

describe('txMatchesRulePattern', () => {
  describe('no category_set_manually guard', () => {
    it('matches transactions regardless of category_set_manually value', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'starbucks', category_id: 'cat-coffee' });
      expect(txMatchesRulePattern(makeTx('tx-1', 'STARBUCKS #1234', 0), rule)).toBe(true);
      expect(txMatchesRulePattern(makeTx('tx-2', 'STARBUCKS #1234', 1), rule)).toBe(true);
    });

    it('returns false when pattern does not match', () => {
      const rule = makeRule({ match_type: 'contains', match_text: 'starbucks', category_id: 'cat-coffee' });
      expect(txMatchesRulePattern(makeTx('tx-1', 'MCDONALDS', 0), rule)).toBe(false);
      expect(txMatchesRulePattern(makeTx('tx-2', 'MCDONALDS', 1), rule)).toBe(false);
    });
  });

  describe('multi-condition AND', () => {
    it('requires all conditions to match', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: '',
        category_id: 'cat-x', logic: 'AND',
        conditions: [
          { match_type: 'contains', match_text: 'amazon' },
          { match_type: 'contains', match_text: 'prime' },
        ],
      });
      expect(txMatchesRulePattern({ description: 'AMAZON PRIME VIDEO', amount_cents: 0 }, rule)).toBe(true);
      expect(txMatchesRulePattern({ description: 'AMAZON MARKETPLACE', amount_cents: 0 }, rule)).toBe(false);
    });
  });

  describe('multi-condition OR', () => {
    it('returns true when any condition matches', () => {
      const rule = makeRule({
        match_type: 'contains', match_text: '',
        category_id: 'cat-x', logic: 'OR',
        conditions: [
          { match_type: 'contains', match_text: 'netflix' },
          { match_type: 'contains', match_text: 'hulu' },
        ],
      });
      expect(txMatchesRulePattern({ description: 'HULU LLC', amount_cents: 0 }, rule)).toBe(true);
      expect(txMatchesRulePattern({ description: 'DISNEY PLUS', amount_cents: 0 }, rule)).toBe(false);
    });
  });

  describe('legacy fallback', () => {
    it('uses match_type/match_text when conditions is empty', () => {
      const rule = makeRule({ match_type: 'ends_with', match_text: 'github.com', category_id: 'cat-tech', conditions: [] });
      expect(txMatchesRulePattern({ description: 'SUBSCRIPTION GITHUB.COM', amount_cents: 0 }, rule)).toBe(true);
      expect(txMatchesRulePattern({ description: 'GITHUB.COM SUBSCRIPTION', amount_cents: 0 }, rule)).toBe(false);
    });
  });

  describe('amount conditions', () => {
    it('matches amount_gt for already-categorized transactions', () => {
      const rule = makeRule({ match_type: 'amount_gt', match_text: '5000', category_id: 'cat-big' });
      expect(txMatchesRulePattern({ description: '', amount_cents: 5001 }, rule)).toBe(true);
      expect(txMatchesRulePattern({ description: '', amount_cents: 5000 }, rule)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Ordering contract: user rules ALWAYS win over foundational rules
// ---------------------------------------------------------------------------

/**
 * makeFoundationalRule simulates what getActiveFoundationalRulesAsRules returns:
 * a Rule-shaped object whose id starts with "foundational:" and priority is 9999.
 */
function makeFoundationalRule(
  ruleId: string,
  matchText: string,
  categoryId: string,
): Rule {
  return makeRule({
    id:          `foundational:${ruleId}`,
    match_type:  'contains',
    match_text:  matchText,
    category_id: categoryId,
    logic:       'OR',
    conditions:  [{ match_type: 'contains', match_text: matchText }],
    priority:    9999,
  });
}

describe('ordering contract: user rules before foundational rules', () => {
  const userRule = makeRule({
    id:          'user-rule-1',
    match_type:  'contains',
    match_text:  'starbucks',
    category_id: 'cat-user-coffee',  // user mapped starbucks to their own category
    priority:    1,
  });

  const foundationalRule = makeFoundationalRule(
    'food-dining',
    'starbucks',           // same merchant — foundational also matches
    'cat-foundational-food',
  );

  it('user rule wins when both user and foundational rules match the same transaction', () => {
    const tx = makeTx('tx-1', 'STARBUCKS #1234');
    // Merged array: user first, then foundational — mirrors autoApplyRulesForAccount
    const merged = [userRule, foundationalRule];
    const result = applyRulesToTransactions([tx], merged);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('user-rule-1');
    expect(result[0].categoryId).toBe('cat-user-coffee');
  });

  it('foundational rule applies when no user rule matches', () => {
    const tx = makeTx('tx-1', 'MCDONALDS');
    const userRuleMiss = makeRule({
      match_type: 'contains', match_text: 'starbucks', category_id: 'cat-user-coffee',
    });
    const foundMcD = makeFoundationalRule('food-dining', 'mcdonald', 'cat-food');
    const merged = [userRuleMiss, foundMcD];
    const result = applyRulesToTransactions([tx], merged);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('foundational:food-dining');
    expect(result[0].categoryId).toBe('cat-food');
  });

  it('reordering foundational before user flips the winner (proof the order matters)', () => {
    const tx = makeTx('tx-1', 'STARBUCKS #1234');
    // Wrong order: foundational first — this is what we must NEVER do in production
    const wrongOrder = [foundationalRule, userRule];
    const result = applyRulesToTransactions([tx], wrongOrder);
    // Foundational wins because it's first — proves the array order is the mechanism
    expect(result[0].ruleId).toBe('foundational:food-dining');
    expect(result[0].categoryId).toBe('cat-foundational-food');
  });

  it('multiple user rules at different priorities; all run before any foundational rule', () => {
    const userRule2 = makeRule({
      id:          'user-rule-2',
      match_type:  'contains',
      match_text:  'lyft',
      category_id: 'cat-rideshare',
      priority:    2,
    });
    const foundTransport = makeFoundationalRule('transportation', 'lyft', 'cat-transport');

    const merged = [userRule, userRule2, foundTransport];
    const txStarbucks = makeTx('tx-1', 'STARBUCKS #1234');
    const txLyft      = makeTx('tx-2', 'LYFT RIDE');
    const txUnknown   = makeTx('tx-3', 'CVS PHARMACY');

    const results = applyRulesToTransactions([txStarbucks, txLyft, txUnknown], merged);
    expect(results).toHaveLength(2);  // txUnknown has no match
    expect(results.find(r => r.transactionId === 'tx-1')?.ruleId).toBe('user-rule-1');
    expect(results.find(r => r.transactionId === 'tx-2')?.ruleId).toBe('user-rule-2');
  });

  it('disabled foundational rules (excluded from merged array) do not categorize transactions', () => {
    // If getActiveFoundationalRulesAsRules filters correctly, the disabled rule
    // is never in the merged array at all. Simulate by not including it.
    const merged = [userRule]; // foundational excluded — simulates disabled or unmapped state
    const tx = makeTx('tx-1', 'MCDONALDS');
    const result = applyRulesToTransactions([tx], merged);
    expect(result).toHaveLength(0); // userRule doesn't match mcdonalds; nothing to apply
  });

  it('category_set_manually transactions are skipped even when foundational rule matches', () => {
    const merged = [foundationalRule];
    const manualTx = makeTx('tx-1', 'STARBUCKS #1234', 1 /* manually set */);
    const result = applyRulesToTransactions([manualTx], merged);
    expect(result).toHaveLength(0);
  });

  it('byFoundational count is correct for a mix of user and foundational assignments', () => {
    const foundFood = makeFoundationalRule('food-dining', 'mcdonald', 'cat-food');
    const merged = [userRule, foundFood];

    const txStarbucks = makeTx('tx-1', 'STARBUCKS #1234');  // user rule matches
    const txMcD       = makeTx('tx-2', 'MCDONALDS');        // foundational matches
    const txUnknown   = makeTx('tx-3', 'RANDOM STORE');     // no match

    const assignments = applyRulesToTransactions([txStarbucks, txMcD, txUnknown], merged);
    const byFoundational = assignments.filter(a => a.ruleId.startsWith('foundational:')).length;
    const byUserRule     = assignments.filter(a => !a.ruleId.startsWith('foundational:')).length;

    expect(assignments).toHaveLength(2);
    expect(byFoundational).toBe(1);
    expect(byUserRule).toBe(1);
  });
});
