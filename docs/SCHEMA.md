# Database Schema

> Source of truth: [`src/db/client.ts`](../src/db/client.ts) (DDL + migrations), [`src/db/queries.ts`](../src/db/queries.ts) (TypeScript types + queries), [`src/db/backup.ts`](../src/db/backup.ts) (export/restore format).
>
> Update this file in the same commit as any schema change. The ship checklist in [CLAUDE.md](../CLAUDE.md) requires it.

**Database**: local SQLite file `budgetapp.db`, opened via `expo-sqlite`.
**Foreign keys**: enabled (`PRAGMA foreign_keys = ON`). Cascading deletes are intentional.
**Schema version**: tracked via `PRAGMA user_version`. Current = **13** (v4.6).

---

## Conventions

| Concept | Storage | Notes |
|---|---|---|
| Money | `INTEGER` (cents, signed) | Negative = expense/debit, positive = income/credit. Never floats. |
| Dates | `TEXT` ISO `YYYY-MM-DD` | Lex order = chronological, so `ORDER BY date` works. |
| Months | `TEXT` `YYYY-MM` | Used as a column on `budgets`. Derived elsewhere via `substr(date, 1, 7)`. |
| Years | derived | `substr(date, 1, 4)`. |
| Timestamps | `INTEGER` ms since epoch | `created_at`, `imported_at`, `dropped_at`. |
| Booleans | `INTEGER` 0 or 1 | `is_pending`, `category_set_manually`, `suggest_rules`. |
| IDs | `TEXT` | Account/category/rule IDs are random; transaction IDs are deterministic SHA256 (see [ARCHITECTURE.md](ARCHITECTURE.md#csv-import--transaction-ids)). |
| JSON blobs | `TEXT` | `accounts.column_config`, `rules.conditions`. Parse defensively. |

---

## Tables

### `accounts`
A user's bank account (checking or credit card).

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Random ID. |
| `name` | `TEXT NOT NULL` | User-facing label. |
| `type` | `TEXT NOT NULL` | `CHECK IN ('checking', 'credit_card')`. |
| `csv_format` | `TEXT NOT NULL` | `'boa_checking_v1'` \| `'citi_cc_v1'`. Determines default `column_config`. |
| `column_config` | `TEXT` | JSON `ColumnConfig` (see below). Nullable for v1 accounts; backfilled in migration v3. |
| `created_at` | `INTEGER NOT NULL` | ms timestamp. |
| `suggest_rules` | `INTEGER NOT NULL DEFAULT 1` | 1 = show rule-suggestion banner after manual categorization; 0 = show plain undo banner. |

**Cascade**: deleting an account deletes its `import_batches`, `transactions`, `rules`, and `budgets`.

---

### `import_batches`
Metadata about one CSV import.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | |
| `account_id` | `TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | |
| `filename` | `TEXT` | Source filename if known. |
| `imported_at` | `INTEGER NOT NULL` | ms timestamp. |
| `rows_total` | `INTEGER NOT NULL` | Rows parsed from CSV. |
| `rows_inserted` | `INTEGER NOT NULL` | New transactions added. |
| `rows_skipped_duplicate` | `INTEGER NOT NULL` | Exact ID matches already in DB. |
| `rows_cleared` | `INTEGER NOT NULL DEFAULT 0` | Pending → cleared updates. |
| `rows_dropped` | `INTEGER NOT NULL DEFAULT 0` | Pendings that disappeared from the bank's feed. |

---

### `transactions`
Individual transactions imported from CSVs.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Deterministic SHA256 (see [ARCHITECTURE.md](ARCHITECTURE.md#csv-import--transaction-ids)). |
| `account_id` | `TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | |
| `date` | `TEXT NOT NULL` | `YYYY-MM-DD`. |
| `amount_cents` | `INTEGER NOT NULL` | Signed. |
| `description` | `TEXT NOT NULL` | Normalized via `normalizeDescription()`. |
| `original_description` | `TEXT NOT NULL` | Verbatim from CSV. |
| `is_pending` | `INTEGER NOT NULL DEFAULT 0` | 1 = still pending in bank feed. |
| `dropped_at` | `INTEGER DEFAULT NULL` | Set when a pending transaction disappeared from a later import. **Filtered out of all summaries** (`dropped_at IS NULL` clause). |
| `import_batch_id` | `TEXT NOT NULL REFERENCES import_batches(id)` | Which import created this row. |
| `created_at` | `INTEGER NOT NULL` | ms timestamp. |
| `category_id` | `TEXT REFERENCES categories(id) ON DELETE SET NULL` | Nullable. |
| `category_set_manually` | `INTEGER NOT NULL DEFAULT 0` | 1 = user picked it; 0 = rule applied (or none). Manual rows are skipped by rule auto-apply. |
| `applied_rule_id` | `TEXT` | Which rule categorized this row. Contract: `NULL` (manual or uncategorized), a real `rules.id` (user rule), or `'foundational:<rule_id>'` (built-in rule). **No FK** — the foreign key was dropped in migration 12 to allow synthetic foundational IDs. `ON DELETE SET NULL` for user rules is now enforced in code: `deleteRule` clears matching rows. |

**Indexes**:
- `idx_tx_account_date` on `(account_id, date DESC)`
- `idx_tx_date` on `(date DESC)`

---

### `categories`
User-defined spend/income categories.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | |
| `color` | `TEXT NOT NULL` | Hex like `#6FA882`. Picked from the 8-swatch palette in `src/domain/category-colors.ts`. |
| `emoji` | `TEXT` | Nullable. A single emoji glyph chosen from the curated picker in `app/category/new.tsx` (`CATEGORY_EMOJIS`). Added in migration v10. |
| `description` | `TEXT` | Nullable. Short user-written description. Added in migration v10. |
| `exclude_from_totals` | `INTEGER NOT NULL DEFAULT 0` | 1 = transactions in this category are excluded from income/expense/net summaries and shown in a separate "not counted toward totals" row. Use for transfers, investment contributions, etc. Added in migration v13 (v4.6). |
| `created_at` | `INTEGER NOT NULL` | |

Deleting a category sets `transactions.category_id` and any rule references to NULL — but rules cascade-delete via the `rules.category_id` FK (see below), so rules are wiped when their category is deleted.

---

### `rules`
Auto-categorization rules. One rule maps matching transactions on one account to one category.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | |
| `account_id` | `TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | |
| `category_id` | `TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE` | |
| `match_type` | `TEXT NOT NULL` | `CHECK IN ('contains', 'starts_with', 'ends_with', 'equals', 'amount_eq', 'amount_lt', 'amount_gt')`. **Legacy** — mirrors `conditions[0]`. |
| `match_text` | `TEXT NOT NULL` | **Legacy** — mirrors `conditions[0]`. |
| `logic` | `TEXT NOT NULL DEFAULT 'AND'` | `'AND'` \| `'OR'` for multi-condition rules. |
| `conditions` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of `{ match_type, match_text }`. The authoritative match data. |
| `priority` | `INTEGER NOT NULL DEFAULT 100` | Lower = evaluated first. Reorderable via UI. |
| `created_at` | `INTEGER NOT NULL` | |

**Index**: `idx_rules_account_priority` on `(account_id, priority ASC)`.

**Note**: `match_type` and `match_text` columns still exist for backward compat but are not the source of truth. Read/write via `conditions`. `insertRule` and `updateRule` keep `conditions[0]` mirrored into them automatically.

---

### `budgets`
Monthly budget allocation per account+category.

| Column | Type | Notes |
|---|---|---|
| `account_id` | `TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | |
| `category_id` | `TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE` | |
| `month` | `TEXT NOT NULL` | `YYYY-MM`. |
| `amount_cents` | `INTEGER NOT NULL` | Signed (negative = expense budget). |

**Primary key**: `(account_id, category_id, month)` — composite. There is no surrogate `id`.
**Index**: `idx_budgets_account_month` on `(account_id, month)`.
**Zero is absence**: `setBudget(..., 0)` deletes the row rather than storing `0`. The grid renders `null` and `0` the same way (empty cell).

---

### `foundational_rule_settings`
Per-account user state for built-in (foundational) rules. The rule **logic** lives entirely in code (`src/domain/foundational-rules.ts`); this table only records which rules each account has enabled and what category they map to.

| Column | Type | Notes |
|---|---|---|
| `account_id` | `TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | |
| `rule_id` | `TEXT NOT NULL` | Matches `FoundationalRule.id` (e.g. `"food-dining"`). No FK — the rule definitions live in code, not the DB. |
| `category_id` | `TEXT REFERENCES categories(id) ON DELETE SET NULL` | Nullable. The user's chosen category for this rule. A rule with no `category_id` cannot fire (see gating invariant below). |
| `enabled` | `INTEGER NOT NULL DEFAULT 1` | 1 = on, 0 = off. |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Per-account display and run order. Lower value = fires first. Default order is food-dining(0) → groceries(1) → transportation(2) → entertainment(3) → shopping(4) → health(5), which is the globally-optimal permutation. User rules always precede foundational rules regardless of this value. |
| `created_at` | `INTEGER NOT NULL` | ms timestamp. |

**Primary key**: `(account_id, rule_id)`.
**Index**: `idx_foundational_settings_account` on `(account_id)`.

**Toggle gating invariant** (enforced in three places):
1. **DB query** (`getActiveFoundationalRulesAsRules`): `WHERE enabled = 1 AND category_id IS NOT NULL`.
2. **UI**: the enable `Switch` is disabled when `category_id` is null.
3. **Setter**: when a user clears a category mapping (`category_id → null`), `enabled` is automatically set to `0` in the same `upsertFoundationalRuleSetting` call.

**Applied tracking**: when the engine fires a foundational rule it writes `applied_rule_id = 'foundational:<rule_id>'` (e.g. `'foundational:food-dining'`) on the transaction. The existing `getRuleAppliedCounts` query groups by `applied_rule_id`, so applied counts are available for free without schema changes.

**Engine ordering contract**: `autoApplyRulesForAccount` always passes `[...userRules, ...foundationalRules]` to the first-match-wins engine. User rules always win. This comment is documented in `src/domain/rules-engine.ts` and covered by tests in `tests/domain/rules-engine.test.ts`.

---

### `app_preferences`
Lightweight key/value store for app-level boolean flags and settings.

| Column | Type | Notes |
|---|---|---|
| `key` | `TEXT PRIMARY KEY` | String key (e.g. `'v4_welcomed'`). |
| `value` | `TEXT NOT NULL` | String value (e.g. `'true'`). |
| `updated_at` | `INTEGER NOT NULL` | ms timestamp. |

**v4.0 keys in use**:

| Key | Values | Meaning |
|---|---|---|
| `v4_welcomed` | `'true'` / absent | Set after the one-time v4 welcome sheet is dismissed. `app/index.tsx` checks this on load; if absent and the user has accounts, `welcome-v4.tsx` is pushed. |

---

## TypeScript interfaces

Defined in [`src/db/queries.ts`](../src/db/queries.ts) (and `Budget` near the bottom). When you change a column, change the interface in the same edit.

```ts
type AccountType = 'checking' | 'credit_card';
type CsvFormat   = 'boa_checking_v1' | 'citi_cc_v1';
type MatchType   = 'contains' | 'starts_with' | 'ends_with' | 'equals'
                 | 'amount_eq' | 'amount_lt' | 'amount_gt';

interface Account       { id; name; type: AccountType; csv_format: CsvFormat;
                          column_config: string /*JSON*/; created_at: number;
                          suggest_rules: number; }
interface ImportBatch   { id; account_id; filename: string|null; imported_at: number;
                          rows_total; rows_inserted; rows_skipped_duplicate;
                          rows_cleared; rows_dropped; }
interface Transaction   { id; account_id; date: string /*YYYY-MM-DD*/;
                          amount_cents: number; description; original_description;
                          is_pending: number; dropped_at: number|null;
                          import_batch_id; created_at: number;
                          category_id: string|null; category_set_manually: number;
                          applied_rule_id: string|null; }
interface Category      { id; name; color: string /*#hex*/;
                          emoji: string|null;          // v4.0 — nullable
                          description: string|null;    // v4.0 — nullable
                          exclude_from_totals: number; // v4.6 — 0 or 1
                          created_at: number; }
interface RuleCondition { match_type: MatchType; match_text: string; }
interface Rule          { id; account_id; category_id;
                          match_type; match_text;            // legacy mirror of conditions[0]
                          logic: 'AND'|'OR';
                          conditions: RuleCondition[];        // authoritative
                          priority: number; created_at: number; }
interface Budget        { account_id; category_id; month: string /*YYYY-MM*/;
                          amount_cents: number; }
interface AccountSummary{ income_cents; expense_cents; net_cents;
                          excluded_cents: number;        // v4.6 — sum of excluded-category amounts
                          transaction_count; last_imported_at: number|null; }
// v4.0 — new tables
interface FoundationalRuleSetting {
  account_id:  string;
  rule_id:     string;  // matches FoundationalRule.id in src/domain/foundational-rules.ts
  category_id: string|null;
  enabled:     number;  // 0 or 1
  created_at:  number;
}
interface AppPreference { key: string; value: string; updated_at: number; }
```

`ColumnConfig` (in [`src/parsers/column-config.ts`](../src/parsers/column-config.ts)):

```ts
interface ColumnConfig {
  dateColumn: string;
  descriptionColumn: string;
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  amountStyle: 'signed' | 'debit_credit';
  signedAmountColumn?: string;     // when amountStyle = 'signed'
  headerContains?: string;         // skip CSV preamble until this header line is found
  debitColumn?: string;            // when amountStyle = 'debit_credit'
  creditColumn?: string;
  pendingColumn?: string;          // optional: column whose value indicates pending status
  clearedValue?: string;           // value in pendingColumn that means "cleared" (anything else = pending)
}
```

---

## Migration history

All migrations live in [`src/db/client.ts`](../src/db/client.ts) under `getDb()`. They run in order; each is idempotent (guarded with `try/catch` or `IF NOT EXISTS`). **Never edit a past migration** — add a new one and bump `LATEST_DB_VERSION`.

| Version | What changed |
|---|---|
| 1 | Base schema: `accounts`, `import_batches`, `transactions` + tx indexes. |
| 2 | `transactions.dropped_at`, `import_batches.rows_cleared`, `import_batches.rows_dropped`. |
| 3 | `accounts.column_config` (nullable). Backfills BoA + Citi defaults for legacy rows. |
| 4 | One-time orphan cleanup — deletes `transactions` and `import_batches` whose `account_id` no longer exists (legacy bug from before FKs were enabled). |
| 5 | Adds `categories` and `rules` tables. Adds `transactions.category_id`, `category_set_manually`, `applied_rule_id`. Indexes rules by `(account_id, priority)`. |
| 6 | Expands `rules.match_type` CHECK to include `amount_eq`/`amount_lt`/`amount_gt`. Recreates the table (SQLite can't `ALTER` a CHECK). Safe to retry if interrupted (drops leftover `rules_new`). |
| 7 | Multi-condition rules: adds `rules.logic` (`'AND'` default) and `rules.conditions` (JSON, `'[]'` default). Backfills existing single-condition rules into `conditions`. |
| 8 | `accounts.suggest_rules` (default 1). |
| 9 | Adds `budgets` table + `idx_budgets_account_month` index. |
| 10 | Adds `categories.emoji` and `categories.description` (both nullable). Adds `foundational_rule_settings` table + `idx_foundational_settings_account`. Adds `app_preferences` table. |
| 11 | Adds `foundational_rule_settings.sort_order` (per-account display/run order). Backfills the optimal default order. |
| 12 | Recreates `transactions` to drop the FK on `applied_rule_id` so synthetic `'foundational:<id>'` IDs can be persisted. Backfills `applied_rule_id` for existing rows that pre-fix code categorized via foundational rules but stored NULL. `deleteRule` now clears `applied_rule_id` in code (replacing the dropped `ON DELETE SET NULL` cascade). |
| 13 | Adds `categories.exclude_from_totals INTEGER NOT NULL DEFAULT 0`. Transactions in excluded categories are tracked but omitted from income/expense/net summaries; shown in a separate "not counted toward totals" row. |

**Pre-migration backup**: before any pending migration runs, [`writePreMigrationBackup`](../src/db/client.ts) writes a snapshot of all known tables to `Documents/slo-n-ready-backup.json` so the user can roll back if a migration fails. Don't bypass this.

---

## Backup file format

File path: `Documents/slo-n-ready-backup.json` (constant `BACKUP_PATH` in [`src/db/backup.ts`](../src/db/backup.ts)).

Backups are written automatically after CSV imports, account changes, and on demand via the Backup screen. They include every row of every table.

```ts
interface BackupData {
  version:                    number;       // 1, 2, 3, or 4 — see compatibility below
  exported_at:                number;       // ms timestamp
  accounts:                   Account[];
  import_batches:             ImportBatch[];
  transactions:               Transaction[];
  categories:                 Category[];   // present from v2; emoji/description fields from v4
  rules:                      Rule[];       // present from v2
  budgets:                    Budget[];     // present from v3
  foundational_rule_settings: FoundationalRuleSetting[]; // present from v4
  app_preferences:            AppPreference[];            // present from v4
}
```

**Compatibility** (`readBackupFromPath` accepts v1–v4):
- v1: pre-categories. `categories`/`rules`/`budgets` may be missing.
- v2: includes categories + rules.
- v3: adds `budgets`.
- v4: adds `foundational_rule_settings` and `app_preferences`; `categories` rows gain `emoji` and `description`. **Current.**

`restoreFromData` deletes all rows in FK-safe order (children before parents), then re-inserts everything inside one transaction. Missing fields are backfilled with safe defaults (`suggest_rules ?? 1`, `dropped_at ?? null`, `conditions ?? '[]'`, etc.).

**When to bump `BackupData.version`**: any time you add a new table to the backup or change the shape of an existing field in a non-additive way. Bump in `writeBackup` (write the new version) and add the new version to the accept-list in `readBackupFromPath`.

---

## When you change the schema

1. Add a new `if (version < N)` block in `src/db/client.ts` and bump `LATEST_DB_VERSION` to `N`. Keep statements idempotent (`IF NOT EXISTS`, `try/catch` around `ALTER`).
2. Update the relevant TypeScript interface in `src/db/queries.ts`.
3. Update [`writeBackup`](../src/db/backup.ts) to include the new column/table in the export, and [`restoreFromData`](../src/db/backup.ts) to import it (with a safe default for older backups).
4. Bump `BackupData.version` if the change is non-additive or adds a new table.
5. **Update this file** — the migration table, the table reference, and the TypeScript snippet.
6. Add a query test if the change has non-trivial logic (e.g. a new `WHERE` clause, a new aggregate).
