// Foundational rule settings (v4.0)
// Logic for each foundational rule lives in src/domain/foundational-rules.ts.
// User state (enabled flag + category mapping) lives here, keyed per account.

import { getDb } from '../client';
import type { Rule } from './rules';

export interface FoundationalRuleSetting {
  account_id:  string;
  rule_id:     string;   // matches FoundationalRule.id, e.g. "food-dining"
  category_id: string | null;
  enabled:     number;   // 1 = enabled, 0 = disabled
  sort_order:  number;   // display/run order within this account (lower = earlier)
  created_at:  number;
}

export async function getFoundationalRuleSettingsForAccount(
  accountId: string,
): Promise<FoundationalRuleSetting[]> {
  const db = await getDb();
  return db.getAllAsync<FoundationalRuleSetting>(
    `SELECT * FROM foundational_rule_settings WHERE account_id = ?`,
    accountId,
  );
}

/** Upsert the category + enabled state for one foundational rule on one account. */
export async function upsertFoundationalRuleSetting(
  accountId:  string,
  ruleId:     string,
  categoryId: string | null,
  enabled:    number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO foundational_rule_settings (account_id, rule_id, category_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, rule_id) DO UPDATE SET category_id = excluded.category_id,
                                                     enabled     = excluded.enabled`,
    accountId, ruleId, categoryId, enabled, Date.now(),
  );
}

/**
 * Bulk-upsert foundational rule settings for one account in a single
 * transaction. Used by the per-account foundational-rules onboarding screen.
 * Pass sort_order on each row to persist the display/run order; it defaults
 * to the row's position in the array when omitted.
 */
export async function bulkUpsertFoundationalRuleSettings(
  accountId: string,
  rows: { rule_id: string; category_id: string | null; enabled: number; sort_order?: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sortOrder = r.sort_order ?? i;
      await db.runAsync(
        `INSERT INTO foundational_rule_settings (account_id, rule_id, category_id, enabled, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, rule_id) DO UPDATE SET category_id = excluded.category_id,
                                                         enabled     = excluded.enabled,
                                                         sort_order  = excluded.sort_order`,
        accountId, r.rule_id, r.category_id, r.enabled, sortOrder, now,
      );
    }
  });
}

/**
 * Persist a new display/run order for foundational rules on one account.
 * Pass the rule IDs in the desired order (index 0 = highest priority).
 */
export async function reorderFoundationalRules(
  accountId: string,
  orderedRuleIds: string[],
): Promise<void> {
  if (orderedRuleIds.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedRuleIds.length; i++) {
      await db.runAsync(
        `UPDATE foundational_rule_settings SET sort_order = ? WHERE account_id = ? AND rule_id = ?`,
        i, accountId, orderedRuleIds[i],
      );
    }
  });
}

/**
 * Returns Rule-shaped objects (id prefixed "foundational:<rule_id>") for all
 * enabled foundational rules that have a category mapped for this account.
 *
 * INVARIANT: a rule with no category_id is NEVER returned, even if enabled = 1.
 * This mirrors the UI constraint (toggle disabled without a category) and the DB
 * filter here as a belt-and-suspenders guarantee.
 */
export async function getActiveFoundationalRulesAsRules(accountId: string): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FoundationalRuleSetting>(
    `SELECT * FROM foundational_rule_settings
     WHERE account_id = ? AND enabled = 1 AND category_id IS NOT NULL
     ORDER BY sort_order ASC`,
    accountId,
  );
  // Lazy import to avoid a load-time cycle with foundational-rules.ts.
  const { FOUNDATIONAL_RULES } = await import('../../domain/foundational-rules');
  const ruleMap = new Map(FOUNDATIONAL_RULES.map(r => [r.id, r]));

  return rows
    .map(setting => {
      const fr = ruleMap.get(setting.rule_id);
      if (!fr || !setting.category_id) return null;
      const first = fr.conditions[0];
      return {
        id:          `foundational:${fr.id}`,
        account_id:  accountId,
        category_id: setting.category_id,
        match_type:  first.match_type,
        match_text:  first.match_text,
        logic:       fr.logic as 'AND' | 'OR',
        conditions:  fr.conditions,
        priority:    9999,  // always last — user rules are lower numbers
        created_at:  setting.created_at,
      } satisfies Rule;
    })
    .filter((r): r is Rule => r !== null);
}
