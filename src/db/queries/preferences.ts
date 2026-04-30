// App preferences (v4.0)
// Lightweight key/value store for app-level flags.
// v4.0 keys: "v4_welcomed" (set to "true" after welcome sheet dismisses)

import { getDb } from '../client';

export interface AppPreference {
  key:        string;
  value:      string;
  updated_at: number;
}

export async function getPreference(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_preferences WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

export async function setPreference(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, value, Date.now(),
  );
}
