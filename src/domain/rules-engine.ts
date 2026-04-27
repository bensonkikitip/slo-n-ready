import { Rule, getAllAccounts, getRulesForAccount, getUncategorizedTransactionsForAccount, bulkSetTransactionCategories } from '../db/queries';

export interface RuleAssignment {
  transactionId: string;
  categoryId:    string;
  ruleId:        string;
}

export function applyRulesToTransactions(
  transactions: Array<{ id: string; description: string; category_set_manually: number }>,
  rules: Rule[],
): RuleAssignment[] {
  const assignments: RuleAssignment[] = [];

  for (const tx of transactions) {
    if (tx.category_set_manually) continue;

    const lower = tx.description.toLowerCase();
    for (const rule of rules) {
      const pattern = rule.match_text.toLowerCase();
      let matched = false;
      switch (rule.match_type) {
        case 'contains':    matched = lower.includes(pattern);    break;
        case 'starts_with': matched = lower.startsWith(pattern);  break;
        case 'ends_with':   matched = lower.endsWith(pattern);    break;
        case 'equals':      matched = lower === pattern;          break;
      }
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
