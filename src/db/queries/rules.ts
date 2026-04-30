import { getDb } from '../client';

export type MatchType = 'contains' | 'starts_with' | 'ends_with' | 'equals' | 'amount_eq' | 'amount_lt' | 'amount_gt';

export interface RuleCondition {
  match_type: MatchType;
  match_text: string;
}

export interface Rule {
  id: string;
  account_id: string;
  category_id: string;
  match_type: MatchType;      // mirrors conditions[0] — kept for backward compat
  match_text: string;         // mirrors conditions[0] — kept for backward compat
  logic: 'AND' | 'OR';
  conditions: RuleCondition[];
  priority: number;
  created_at: number;
}

function parseRuleConditions(row: any): RuleCondition[] {
  try {
    const parsed = JSON.parse(row.conditions ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return [{ match_type: row.match_type, match_text: row.match_text }];
}

export async function getRulesForAccount(accountId: string): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM rules WHERE account_id = ? ORDER BY priority ASC`,
    accountId,
  );
  return rows.map(r => ({
    ...r,
    logic:      (r.logic ?? 'AND') as 'AND' | 'OR',
    conditions: parseRuleConditions(r),
  }));
}

export async function insertRule(rule: Omit<Rule, 'created_at'>): Promise<void> {
  const db = await getDb();
  const first = rule.conditions?.[0] ?? { match_type: rule.match_type, match_text: rule.match_text };
  await db.runAsync(
    `INSERT INTO rules (id, account_id, category_id, match_type, match_text, logic, conditions, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rule.id, rule.account_id, rule.category_id,
    first.match_type, first.match_text,
    rule.logic ?? 'AND',
    JSON.stringify(rule.conditions ?? [first]),
    rule.priority, Date.now(),
  );
}

export async function updateRule(
  id: string,
  fields: {
    match_type?: MatchType; match_text?: string; category_id?: string;
    logic?: 'AND' | 'OR'; conditions?: RuleCondition[];
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: any[] = [];
  if (fields.match_type  !== undefined) { sets.push('match_type = ?');  values.push(fields.match_type); }
  if (fields.match_text  !== undefined) { sets.push('match_text = ?');  values.push(fields.match_text); }
  if (fields.category_id !== undefined) { sets.push('category_id = ?'); values.push(fields.category_id); }
  if (fields.logic       !== undefined) { sets.push('logic = ?');       values.push(fields.logic); }
  if (fields.conditions  !== undefined) { sets.push('conditions = ?');  values.push(JSON.stringify(fields.conditions)); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE rules SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteRule(id: string): Promise<void> {
  // Migration 12 dropped the FK on transactions.applied_rule_id, so the
  // previous ON DELETE SET NULL behavior is now enforced here in code.
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE transactions SET applied_rule_id = NULL WHERE applied_rule_id = ?`, id);
    await db.runAsync(`DELETE FROM rules WHERE id = ?`, id);
  });
}

export async function reorderRules(orderedIds: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(`UPDATE rules SET priority = ? WHERE id = ?`, i + 1, orderedIds[i]);
    }
  });
}

export async function getRuleAppliedCounts(accountId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ rule_id: string; count: number }>(
    `SELECT applied_rule_id AS rule_id, COUNT(*) AS count
     FROM transactions
     WHERE account_id = ? AND applied_rule_id IS NOT NULL AND dropped_at IS NULL
     GROUP BY applied_rule_id`,
    accountId,
  );
  return Object.fromEntries(rows.map(r => [r.rule_id, r.count]));
}
