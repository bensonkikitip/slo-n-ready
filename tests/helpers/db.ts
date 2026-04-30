// Test helper: hand each test a freshly-initialized in-memory DB. Resets module
// state on the expo-sqlite + expo-file-system mocks AND on src/db/client.ts's
// singleton so every test starts from a clean slate without leaking data.

type ClientModule = typeof import('../../src/db/client');
type QueriesModule = typeof import('../../src/db/queries');
type BackupModule = typeof import('../../src/db/backup');
type RulesEngineModule = typeof import('../../src/domain/rules-engine');
type ExpoSQLite = typeof import('expo-sqlite') & { _resetMockDbs: () => void };
type ExpoFs = typeof import('expo-file-system/legacy') & {
  _resetMockFs: () => void;
  _peekMockFs: () => Map<string, string>;
};

export interface TestDb {
  client: ClientModule;
  queries: QueriesModule;
  backup: BackupModule;
  rulesEngine: RulesEngineModule;
  fs: ExpoFs;
  /** The underlying SQLiteDatabase handle, fully migrated. */
  db: Awaited<ReturnType<ClientModule['getDb']>>;
}

/**
 * Open a fresh in-memory DB with all migrations applied. Call this in
 * `beforeEach` so every test starts isolated. The returned `client`, `queries`,
 * and `backup` modules are re-required against the same fresh DB instance, so
 * call query functions through the returned modules — not via top-level imports
 * in the test file (those would point at a stale singleton).
 */
export async function createTestDb(): Promise<TestDb> {
  jest.resetModules();
  const expoSqlite = require('expo-sqlite') as ExpoSQLite;
  expoSqlite._resetMockDbs();
  const fs = require('expo-file-system/legacy') as ExpoFs;
  fs._resetMockFs();

  const client = require('../../src/db/client') as ClientModule;
  const queries = require('../../src/db/queries') as QueriesModule;
  const backup = require('../../src/db/backup') as BackupModule;
  const rulesEngine = require('../../src/domain/rules-engine') as RulesEngineModule;
  const db = await client.getDb();
  return { client, queries, backup, rulesEngine, fs, db };
}
