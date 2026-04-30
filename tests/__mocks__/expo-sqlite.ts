// In-memory expo-sqlite adapter backed by better-sqlite3, used in the Node/Jest
// test environment where the real native module isn't available. Implements the
// 5 methods the app uses (execAsync, runAsync, getAllAsync, getFirstAsync,
// withTransactionAsync) plus closeAsync. FK enforcement and PRAGMA support are
// real, so tests catch the same correctness issues a device would.
import Database from 'better-sqlite3';

type Param = string | number | bigint | Buffer | null;

function flattenParams(params: unknown[]): Param[] {
  // expo-sqlite accepts both `runAsync(sql, a, b, c)` and `runAsync(sql, [a, b, c])`.
  // Normalize to the spread shape that better-sqlite3 expects.
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as Param[];
  }
  return params as Param[];
}

export class SQLiteDatabase {
  private db: Database.Database;
  // Real expo-sqlite serializes operations on a single connection internally.
  // better-sqlite3 is synchronous and rejects nested BEGIN, so we queue
  // transactions to mirror the production semantics.
  private txTail: Promise<void> = Promise.resolve();

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, ...params: unknown[]): Promise<{ lastInsertRowId: number; changes: number }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...flattenParams(params));
    return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
  }

  async getAllAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...flattenParams(params)) as T[];
  }

  async getFirstAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...flattenParams(params));
    return (row as T) ?? null;
  }

  async withTransactionAsync(cb: () => Promise<void>): Promise<void> {
    // Chain onto the txTail so concurrent callers serialize, mirroring real
    // expo-sqlite. better-sqlite3's `transaction()` helper is synchronous;
    // we use BEGIN/COMMIT/ROLLBACK manually to support the async callback.
    const next = this.txTail.then(async () => {
      this.db.exec('BEGIN');
      try {
        await cb();
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
    // Keep the chain alive even if this transaction fails
    this.txTail = next.catch(() => undefined);
    return next;
  }

  async closeAsync(): Promise<void> {
    if (this.db.open) this.db.close();
  }
}

const _dbs = new Map<string, SQLiteDatabase>();

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  let db = _dbs.get(name);
  if (!db) {
    db = new SQLiteDatabase();
    _dbs.set(name, db);
  }
  return db;
}

/** Test-only: close every open in-memory DB and clear the cache. */
export function _resetMockDbs(): void {
  for (const db of _dbs.values()) {
    try { db.closeAsync(); } catch {}
  }
  _dbs.clear();
}
