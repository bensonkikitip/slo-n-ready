import { Rule, RuleCondition, MatchType, getAllAccounts, getRulesForAccount, getUncategorizedTransactionsForAccount, bulkSetTransactionCategories } from '../db/queries';

export interface RuleAssignment {
  transactionId: string;
  categoryId:    string;
  ruleId:        string;
}

function matchesCondition(
  tx: { description: string; amount_cents: number },
  cond: RuleCondition,
): boolean {
  const lower = (tx.description ?? '').toLowerCase();
  const pattern = cond.match_text.toLowerCase();
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

export async function autoApplyRulesForAccount(accountId: string): Promise<number> {
  const [rules, transactions] = await Promise.all([
    getRulesForAccount(accountId),
    getUncategorizedTransactionsForAccount(accountId),
  ]);
  if (rules.length === 0 || transactions.length === 0) return 0;
  const assignments = applyRulesToTransactions(transactions, rules);
  await bulkSetTransactionCategories(assignments);
  return assignments.length;
}

export async function autoApplyAllRules(): Promise<number> {
  const accounts = await getAllAccounts();
  let total = 0;
  for (const account of accounts) {
    total += await autoApplyRulesForAccount(account.id);
  }
  return total;
}
