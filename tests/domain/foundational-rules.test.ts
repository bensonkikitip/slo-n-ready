/**
 * Foundational rules tests.
 *
 * Covers:
 * - Shape of every rule in FOUNDATIONAL_RULES
 * - No duplicate rule IDs
 * - Each rule has non-empty conditions all using valid MatchType values
 * - Snapshot — accidental edits to the rule set surface as test failures in PRs
 */

import { FOUNDATIONAL_RULES, FoundationalRule } from '../../src/domain/foundational-rules';

const VALID_MATCH_TYPES = new Set([
  'contains', 'starts_with', 'ends_with', 'equals',
  'amount_eq', 'amount_lt', 'amount_gt',
]);

describe('FOUNDATIONAL_RULES', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(FOUNDATIONAL_RULES)).toBe(true);
    expect(FOUNDATIONAL_RULES.length).toBeGreaterThan(0);
  });

  it('has no duplicate rule IDs', () => {
    const ids = FOUNDATIONAL_RULES.map(r => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('has no duplicate rule names', () => {
    const names = FOUNDATIONAL_RULES.map(r => r.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  describe.each(FOUNDATIONAL_RULES)('rule: $name', (rule: FoundationalRule) => {
    it('has a non-empty id (kebab-case with no spaces)', () => {
      expect(typeof rule.id).toBe('string');
      expect(rule.id.trim().length).toBeGreaterThan(0);
      expect(rule.id).not.toContain(' ');
    });

    it('has a non-empty name', () => {
      expect(typeof rule.name).toBe('string');
      expect(rule.name.trim().length).toBeGreaterThan(0);
    });

    it('has a non-empty emoji', () => {
      expect(typeof rule.emoji).toBe('string');
      expect(rule.emoji.trim().length).toBeGreaterThan(0);
    });

    it('has a non-empty description', () => {
      expect(typeof rule.description).toBe('string');
      expect(rule.description.trim().length).toBeGreaterThan(0);
    });

    it('has a non-empty defaultCategoryName', () => {
      expect(typeof rule.defaultCategoryName).toBe('string');
      expect(rule.defaultCategoryName.trim().length).toBeGreaterThan(0);
    });

    it('logic is always OR', () => {
      expect(rule.logic).toBe('OR');
    });

    it('has at least 3 conditions', () => {
      expect(Array.isArray(rule.conditions)).toBe(true);
      expect(rule.conditions.length).toBeGreaterThanOrEqual(3);
    });

    it('every condition has a valid match_type', () => {
      for (const cond of rule.conditions) {
        expect(VALID_MATCH_TYPES.has(cond.match_type)).toBe(true);
      }
    });

    it('every condition has a non-empty match_text', () => {
      for (const cond of rule.conditions) {
        expect(typeof cond.match_text).toBe('string');
        expect(cond.match_text.trim().length).toBeGreaterThan(0);
      }
    });

    it('does not have a funFact field', () => {
      // funFact was explicitly removed from the design
      expect((rule as any).funFact).toBeUndefined();
    });
  });

  it('includes the expected 6 rule IDs (snapshot)', () => {
    const ids = FOUNDATIONAL_RULES.map(r => r.id).sort();
    expect(ids).toEqual([
      'entertainment',
      'food-dining',
      'groceries',
      'health',
      'shopping',
      'transportation',
    ]);
  });

  it('each rule uses only "contains" match_type (text-based matching)', () => {
    // Foundational rules are pure text patterns — no amount conditions
    for (const rule of FOUNDATIONAL_RULES) {
      for (const cond of rule.conditions) {
        expect(cond.match_type).toBe('contains');
      }
    }
  });
});
