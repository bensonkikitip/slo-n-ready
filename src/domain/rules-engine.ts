import { Rule, RuleCondition, MatchType, getAllAccounts, getRulesForAccount, getActiveFoundationalRulesAsRules, getUncategorizedTransactionsForAccount, bulkSetTransactionCategories } from '../db/queries';

export interface RuleAssignment {
  transactionId: string;
  categoryId:    string;
  ruleId:        string;
}

export interface ApplyResult {
  total:          number;
  byUserRule:     number;
  byFoundational: number;
}

function matchesCondition(
  tx: { description: string; amount_cents: number },
  cond: RuleCondition,
): boolean {
  const lower = (tx.description ?? '').toLowerCase();
  const pattern = cond.match_text.toLowerCase();
  // Guard: empty pattern would match every transaction via .includes("") etc.
  if (!pattern && ['contains', 'starts_with', 'ends_with', 'equals'].includes(cond.match_type)) return false;
  const cents = parseInt(cond.match_text, 10);
  switch (cond.match_type) {
    case 'contains':    return lower.includes(pattern);
    case 'starts_with': return lower.startsWith(pattern);
    case 'ends_with':   return lower.endsWith(pattern);
    case 'equals':      return lower === pattern;
    case 'amount_eq':   return tx.amount_cents === cents;
    case 'amount_lt':   return tx.amount_cents < cents;
    case 'amount_gt':   return tx.amount_cents > cents;
    default:            return false;
  }
}

export function applyRulesToTransactions(
  transactions: Array<{ id: string; description: string; amount_cents: number; category_set_manually: number }>,
  rules: Rule[],
): RuleAssignment[] {
  const assignments: RuleAssignment[] = [];

  for (const tx of transactions) {
    if (tx.category_set_manually) continue;

    for (const rule of rules) {
      const conds = rule.conditions.length > 0
        ? rule.conditions
        : [{ match_type: rule.match_type, match_text: rule.match_text }];

      const matched = rule.logic === 'OR'
        ? conds.some(c  => matchesCondition(tx, c))
        : conds.every(c => matchesCondition(tx, c));

      if (matched) {
        assignments.push({ transactionId: tx.id, categoryId: rule.category_id, ruleId: rule.id });
        break;
      }
    }
  }
  return assignments;
}

export function txMatchesRulePattern(
  tx: { description: string; amount_cents: number },
  rule: Rule,
): boolean {
  const conds = rule.conditions.length > 0
    ? rule.conditions
    : [{ match_type: rule.match_type, match_text: rule.match_text }];
  return rule.logic === 'OR'
    ? conds.some(c => matchesCondition(tx, c))
    : conds.every(c => matchesCondition(tx, c));
}

export function txMatchesSingleRule(
  tx: { description: string; amount_cents: number; category_set_manually: number },
  rule: Rule,
): boolean {
  if (tx.category_set_manually) return false;
  return txMatchesRulePattern(tx, rule);
}

export async function autoApplyRulesForAccount(accountId: string): Promise<ApplyResult> {
  const [userRules, foundationalRules, transactions] = await Promise.all([
    getRulesForAccount(accountId),
    getActiveFoundationalRulesAsRules(accountId),
    getUncategorizedTransactionsForAccount(accountId),
  ]);

  // ORDERING CONTRACT: user rules ALWAYS run first. Foundational rules are appended
  // at the end as a final fallback layer. applyRulesToTransactions is first-match-wins
  // by array order, so a user rule always wins when both would match the same
  // transaction. Do not reorder without explicit approval.
  const merged = [...userRules, ...foundationalRules];

  if (merged.length === 0 || transactions.length === 0) {
    return { total: 0, byUserRule: 0, byFoundational: 0 };
  }

  const assignments = applyRulesToTransactions(transactions, merged);
  await bulkSetTransactionCategories(assignments);

  const byFoundational = assignments.filter(a => a.ruleId.startsWith('foundational:')).length;
  return {
    total:          assignments.length,
    byUserRule:     assignments.length - byFoundational,
    byFoundational,
  };
}

export async function autoApplyAllRules(): Promise<number> {
  const accounts = await getAllAccounts();
  const results  = await Promise.all(accounts.map(a => autoApplyRulesForAccount(a.id)));
  return results.reduce((sum, r) => sum + r.total, 0);
}
