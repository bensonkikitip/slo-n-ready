import { getDb } from '../client';

export interface Category {
  id: string;
  name: string;
  color: string;
  emoji: string | null;        // v4.0 — nullable; legacy rows have null
  description: string | null;  // v4.0 — nullable; shown in starter-category UI
  created_at: number;
}

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>(`SELECT * FROM categories ORDER BY name ASC`);
}

export async function insertCategory(category: Omit<Category, 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, color, emoji, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    category.id, category.name, category.color,
    category.emoji ?? null, category.description ?? null,
    Date.now(),
  );
}

export async function updateCategory(
  id: string,
  fields: { name?: string; color?: string; emoji?: string | null; description?: string | null },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (fields.name        !== undefined) { sets.push('name = ?');        values.push(fields.name); }
  if (fields.color       !== undefined) { sets.push('color = ?');       values.push(fields.color); }
  if (fields.emoji       !== undefined) { sets.push('emoji = ?');       values.push(fields.emoji ?? null); }
  if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description ?? null); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM categories WHERE id = ?`, id);
}

/**
 * Bulk-insert categories in a single transaction. Used by the first-time
 * onboarding flow to seed the user's starter categories. Idempotent on (id) —
 * uses INSERT OR IGNORE so re-runs don't error.
 */
export async function bulkInsertCategories(
  rows: Omit<Category, 'created_at'>[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const c of rows) {
      await db.runAsync(
        `INSERT OR IGNORE INTO categories (id, name, color, emoji, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        c.id, c.name, c.color, c.emoji ?? null, c.description ?? null, now,
      );
    }
  });
}
