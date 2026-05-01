import { getDb } from '../client';

export interface Category {
  id: string;
  name: string;
  color: string;
  emoji: string | null;            // v4.0 — nullable; legacy rows have null
  description: string | null;      // v4.0 — nullable; shown in starter-category UI
  exclude_from_totals: number;     // v4.6 — 1 = excluded from income/expense/net; shown as separate total. Default 0.
  created_at: number;
}

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>(`SELECT * FROM categories ORDER BY name ASC`);
}

export async function insertCategory(category: Omit<Category, 'created_at' | 'exclude_from_totals'> & { exclude_from_totals?: number }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, color, emoji, description, exclude_from_totals, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    category.id, category.name, category.color,
    category.emoji ?? null, category.description ?? null,
    category.exclude_from_totals ?? 0,
    Date.now(),
  );
}

export async function updateCategory(
  id: string,
  fields: { name?: string; color?: string; emoji?: string | null; description?: string | null; exclude_from_totals?: number },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (fields.name                !== undefined) { sets.push('name = ?');                values.push(fields.name); }
  if (fields.color               !== undefined) { sets.push('color = ?');               values.push(fields.color); }
  if (fields.emoji               !== undefined) { sets.push('emoji = ?');               values.push(fields.emoji ?? null); }
  if (fields.description         !== undefined) { sets.push('description = ?');         values.push(fields.description ?? null); }
  if (fields.exclude_from_totals !== undefined) { sets.push('exclude_from_totals = ?'); values.push(fields.exclude_from_totals); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM categories WHERE id = ?`, id);
}

/**
 * Merge sourceId into targetId.
 *
 * Everything owned by source is moved to target in a single atomic transaction:
 *   - transactions  →  category_id reassigned
 *   - rules         →  reassigned BEFORE delete (CASCADE would wipe them otherwise)
 *   - foundational_rule_settings  →  reassigned BEFORE delete (SET NULL otherwise)
 *   - budgets (spending goals)    →  summed per (account_id, month) into target
 *   - source category             →  deleted (cascade cleans any remaining budget rows)
 */
export async function mergeCategory(sourceId: string, targetId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // 1. Reassign transactions
    await db.runAsync(
      `UPDATE transactions SET category_id = ? WHERE category_id = ?`,
      targetId, sourceId,
    );

    // 2. Reassign rules (must precede delete to avoid CASCADE loss)
    await db.runAsync(
      `UPDATE rules SET category_id = ? WHERE category_id = ?`,
      targetId, sourceId,
    );

    // 3. Reassign foundational_rule_settings (must precede delete; FK is SET NULL)
    await db.runAsync(
      `UPDATE foundational_rule_settings SET category_id = ? WHERE category_id = ?`,
      targetId, sourceId,
    );

    // 4. Merge spending goals: for each (account_id, month) in source,
    //    upsert into target = source.amount + COALESCE(target.amount, 0).
    await db.runAsync(
      `INSERT OR REPLACE INTO budgets (account_id, category_id, month, amount_cents)
       SELECT b_src.account_id,
              ? AS category_id,
              b_src.month,
              b_src.amount_cents + COALESCE(b_tgt.amount_cents, 0) AS amount_cents
       FROM   budgets b_src
       LEFT JOIN budgets b_tgt
         ON  b_tgt.account_id  = b_src.account_id
         AND b_tgt.category_id = ?
         AND b_tgt.month       = b_src.month
       WHERE  b_src.category_id = ?`,
      targetId, targetId, sourceId,
    );

    // 5. Delete source category — CASCADE removes any remaining budget rows on source
    await db.runAsync(`DELETE FROM categories WHERE id = ?`, sourceId);
  });
}

/**
 * Bulk-insert categories in a single transaction. Used by the first-time
 * onboarding flow to seed the user's starter categories. Idempotent on (id) —
 * uses INSERT OR IGNORE so re-runs don't error.
 */
export async function bulkInsertCategories(
  rows: Array<Omit<Category, 'created_at' | 'exclude_from_totals'> & { exclude_from_totals?: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const c of rows) {
      await db.runAsync(
        `INSERT OR IGNORE INTO categories (id, name, color, emoji, description, exclude_from_totals, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        c.id, c.name, c.color, c.emoji ?? null, c.description ?? null, c.exclude_from_totals ?? 0, now,
      );
    }
  });
}
