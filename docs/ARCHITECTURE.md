# Architecture

> Map of how the code is organized and how the key flows work. Pair with [SCHEMA.md](SCHEMA.md) for data shape. Update this file when screens, components, domain modules, or key flows change — see the ship checklist in [CLAUDE.md](../CLAUDE.md).

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 (managed workflow) |
| Routing | Expo Router 6 (file-based, `app/` directory) |
| Database | `expo-sqlite` — local SQLite, never leaves the device |
| File I/O | `expo-file-system/legacy`, `expo-document-picker`, `expo-sharing` |
| CSV parsing | `papaparse` + custom `ColumnConfig` system |
| ID generation | `js-sha256` (deterministic transaction IDs) |
| Fonts | `@expo-google-fonts/nunito` (400/600/700/800) |
| State | React hooks only — no Redux / Zustand / React Query |
| Styling | `StyleSheet` + design tokens in `src/theme.ts` |
| Tests | Jest + ts-jest, with mocks under `tests/__mocks__/` |

The app makes **zero network requests**. No analytics, no telemetry, no remote sync.

---

## Directory map

```
BudgetApp/
├── app/                          # Expo Router screens (file-based)
│   ├── _layout.tsx               # Root stack layout, font loading, SplashSlogan overlay
│   ├── index.tsx                 # Home: list of accounts + combined summary; triggers v4 welcome
│   ├── all.tsx                   # All-accounts combined transaction view
│   ├── backup.tsx                # Backup / restore UI
│   ├── categories.tsx            # Category management list (shows emoji + description)
│   ├── welcome-v4.tsx            # One-time upgrade welcome sheet for existing v3 users
│   ├── welcome-v4-emoji-suggest.tsx  # Optional: suggest emojis for existing categories
│   ├── account/
│   │   ├── new.tsx               # Create account
│   │   └── [id]/
│   │       ├── index.tsx         # Account detail + transactions
│   │       ├── edit.tsx          # Edit account (name/type/CSV format/columns)
│   │       ├── import.tsx        # CSV import flow (deletes cached CSV; shows categorized count)
│   │       ├── rules.tsx         # Manage rules + foundational rules section
│   │       └── budget.tsx        # Annual budget grid (12 months × categories)
│   └── category/
│       ├── new.tsx               # Create category (name + color + emoji + description)
│       └── [id]/edit.tsx         # Edit category (name + color + emoji + description)
├── src/
│   ├── db/
│   │   ├── client.ts             # SQLite open + migrations (LATEST_DB_VERSION)
│   │   ├── queries.ts            # All DB operations + TypeScript interfaces
│   │   └── backup.ts             # Backup / restore (writeBackup, restoreFromData)
│   ├── domain/                   # Pure logic, easy to unit-test
│   │   ├── rules-engine.ts       # Rule evaluation + auto-apply (user + foundational)
│   │   ├── foundational-rules.ts # Built-in rule definitions (code-side logic; v4.0)
│   │   ├── emoji-suggestions.ts  # Suggest emoji for a category name (v4.0)
│   │   ├── budget.ts             # Budget math (split, %, annual totals)
│   │   ├── money.ts              # cents ⇄ dollars formatting
│   │   ├── month.ts              # Month/year picker data
│   │   ├── transaction-id.ts     # Deterministic SHA256 IDs
│   │   ├── normalize.ts          # Description + date normalization
│   │   └── category-colors.ts    # 8-swatch color palette
│   ├── components/               # Reusable UI (SplashSlogan added v4.0)
│   ├── parsers/
│   │   ├── index.ts              # Parser entry point (registers formats)
│   │   ├── generic-parser.ts     # CSV → ParsedRow[] using a ColumnConfig
│   │   └── column-config.ts      # ColumnConfig type + DEFAULT_CONFIGS
│   └── theme.ts                  # colors / spacing / fonts / account chip colors
├── assets/                       # icons, splash, sloth illustrations, backdrop
├── tests/                        # Jest specs + expo module mocks
├── app.json                      # Expo config (version, bundle id, plugins)
└── package.json
```

---

## Domain modules (`src/domain/`)

Pure functions, no React, no DB. Safe to import anywhere; covered by Jest tests in `tests/domain/`.

| Module | Key exports | What it does |
|---|---|---|
| `rules-engine.ts` | `applyRulesToTransactions(txs, rules) → RuleAssignment[]`, `autoApplyRulesForAccount(accountId) → ApplyResult`, `autoApplyAllRules()` | Evaluates each rule's conditions (AND/OR) against a transaction's normalized description and amount. First-match wins (rules are pre-sorted by `priority ASC`). **Ordering contract**: user rules always run before foundational rules (`[...userRules, ...foundationalRules]`). Returns `ApplyResult { total, byUserRule, byFoundational }`. Skips manually-categorized and dropped transactions. |
| `foundational-rules.ts` | `FOUNDATIONAL_RULES: FoundationalRule[]`, `FoundationalRule` interface | Six built-in categorization rules (Food & Dining, Groceries, Transportation, Entertainment, Shopping, Health). Logic lives entirely in code; user state (enabled/category mapping per account) lives in `foundational_rule_settings` DB table. Covered by `tests/domain/foundational-rules.test.ts`. |
| `emoji-suggestions.ts` | `suggestEmojiForCategory(name) → string\|null`, `suggestEmojisForCategories(cats)` | Pure-function emoji lookup by category name. Tokenises the name, looks up each token in an 80-entry table, returns the first match. Used by the `welcome-v4-emoji-suggest` screen. Covered by `tests/domain/emoji-suggestions.test.ts`. |
| `budget.ts` | `splitYearTotal(cents)`, `computeYearTotal(monthMap, year)`, `applyPercentage(cents, pct)`, `monthsInYear(year)` | Budget math. `splitYearTotal` distributes an annual amount across 12 months with rounding correction so the parts sum back to the original. `monthsInYear` returns 12 `YYYY-MM` keys. |
| `budget-variance.ts` | `buildCategoryRows(budgetRows, actualRows, monthsInRange)`, `computeVarianceSummary(rows)`, `classifyRow(row)`, `computeProgress(row)`, `sortCategoryRows(rows, nameFn)` | Budget vs. actual comparison math. `buildCategoryRows` merges per-month budget and actual data into one row per category for any period (1-month or 12-month range). `classifyRow` is sign-of-budget-aware ('good'/'bad'/'neutral'). `computeProgress` returns a 0–1.5 fill ratio for the progress bar. |
| `money.ts` | `centsToDollars(cents)`, `parseDollarsToCents(value)` | Money formatting. `parseDollarsToCents` handles `$`, commas, parens-as-negative, leading/trailing whitespace. |
| `month.ts` | `buildYearList`, `buildMonthList`, `monthLabel(key)` | Builds picker entries. Always shows a 6-month window around the latest data even if the DB has gaps. |
| `transaction-id.ts` | `assignTransactionIds(rows) → string[]` | Deterministic SHA256 of `accountId\|date\|amount_cents\|normalized_description`, with a sequence counter for exact dupes within the same import. See "CSV import" below. |
| `normalize.ts` | `normalizeDescription(raw)`, `mmddyyyyToIso(date)` | Trim, collapse whitespace, uppercase. Date format conversion. |
| `category-colors.ts` | `CATEGORY_COLORS` (readonly) | The 8 picker swatches: Sage, Peach, Terracotta, Sky, Lavender, Gold, Berry, Slate. |
| `rachey-quotes.ts` | `pickRacheyLine(moment)`, `RACHEY_QUOTES`, `RACHEY_MOMENTS`, `RacheyMoment` | 50 unique encouragement lines across 15 named moments (e.g. `firstImport`, `bulkCategorize`, `milestone100Tx`). Each moment maps to a `SlothKey` pose and a pool of 3–9 lines. `pickRacheyLine` selects one at random. |

---

## Screens (`app/`)

Expo Router maps the file tree directly to routes. `[id]` is a dynamic segment.

| Route | File | Purpose |
|---|---|---|
| `/` | `index.tsx` | Home. Account cards with per-account income/expense/net summaries, combined-all summary, month/year picker, category filter, restore-banner if a backup exists. |
| `/all` | `all.tsx` | All transactions across every account, with the same month/year/category filtering as account detail. |
| `/backup` | `backup.tsx` | Backup status (last saved, counts), export (share sheet → Files / AirDrop), import (document picker → restore). |
| `/categories` | `categories.tsx` | List of categories with color swatches; tap to edit; FAB to create. |
| `/account/new` | `account/new.tsx` | Create-account form (name, type, CSV format, optional column override). |
| `/account/[id]` | `account/[id]/index.tsx` | Transactions for one account. Filter by month/year/category. Bulk-select for batch categorization. Search. Undo banner after a manual categorization. Menu → edit / import / rules / budget. |
| `/account/[id]/edit` | `account/[id]/edit.tsx` | Edit account metadata. Delete account (cascades). |
| `/account/[id]/import` | `account/[id]/import.tsx` | Pick CSV → preview → import → show counts (inserted / cleared / dropped / skipped). |
| `/account/[id]/rules` | `account/[id]/rules.tsx` | List rules in priority order; drag to reorder; tap to edit; create with multi-condition support (AND/OR over text + amount conditions). |
| `/account/[id]/budget` | `account/[id]/budget.tsx` | Annual budget grid: sticky months across, categories down. Cells editable; row & global actions (split annual total, fill from previous year, apply %, copy). Actuals overlay shows real spend per cell. |
| `/category/new` | `category/new.tsx` | Create category (name + color + optional emoji + optional description). Exports `CATEGORY_EMOJIS` constant used by the emoji picker. |
| `/category/[id]/edit` | `category/[id]/edit.tsx` | Edit category (name + color + emoji + description). |
| `/welcome-v4` | `welcome-v4.tsx` | Modal. Shown once to existing users after upgrading from v3.x (checked via `app_preferences.v4_welcomed`). Rachey waving. Lists 3 new v4.0 features. Two CTAs: emoji suggest or dismiss. Writes `v4_welcomed = "true"` and never shows again. |
| `/welcome-v4-emoji-suggest` | `welcome-v4-emoji-suggest.tsx` | Modal. Loads all categories + emoji suggestions; user reviews/overrides per row; saves changed emojis in one pass. Skippable. |

---

## Components (`src/components/`)

| Component | Used in | Purpose |
|---|---|---|
| `SummaryBar` | home, account detail, all | Horizontal income (green) + expense (terracotta) + net bar. |
| `TransactionRow` | account detail, all | Date, description, amount, category badge, pending/dropped flags. Tap to categorize. |
| `MonthPicker` | home, account detail, all | Segmented Month / Year toggle with dropdown. |
| `CategoryPicker` | home, account detail, all | Multi-select category filter pills. |
| `CategoryPickerSheet` | account detail, all | Modal sheet to assign a category to a single transaction. |
| `CategoryBadge` | rows, summaries | Small colored chip with category name. |
| `CategoryFilterBar` | (used by detail screens) | Compact filter UI for in-row use. |
| `BudgetCellModal` | budget grid | Edit one budget cell. |
| `BudgetRowActionsModal` | budget grid | Row menu: split year total, fill from prev year, apply %, clear. |
| `BudgetFillPercentModal` | budget grid | Input a % to apply across a row or the whole grid. |
| `ActivityBudgetToggle` | home, account detail, all accounts | Segmented "Activity / Budget" control near the month picker. |
| `BudgetVarianceSummary` | home, account detail, all accounts | 3-cell block (same shape as `SummaryBar`) showing income actual + variance, expense actual + variance, and net variance. |
| `BudgetCategoryRow` | `BudgetView` | One category row with color dot, progress bar, budget/actual amounts, and variance. |
| `BudgetView` | account detail, all accounts | Container: renders `BudgetVarianceSummary` + optional YTD chip + `FlatList` of `BudgetCategoryRow`s. Shows empty state with CTA when no budget is set. |
| `Sloth` | empty states, splash, welcome screens | Mascot SVGs (meditating, sleeping, laptop, piggyBank, waving, dreaming, etc.). |
| `RacheyBanner` | categories, home, rules, account detail, import, backup | Inline banner: small Rachey pose (52px) + random encouragement line + dismiss ×. Locks pose and line on mount via `useState(() => pickRacheyLine(moment))` so it never re-randomizes mid-render. |
| `SplashSlogan` | `_layout.tsx` (root overlay) | Animated branded card shown on every cold launch. Displays Rachey in `meditating` pose + 3-line slogan. Visible for 800 ms, then fades over 400 ms. `pointerEvents="none"` — never blocks input. Mounts as an absolute overlay over the Stack; `_layout.tsx` hides it via `showSplash` state when `onDone` fires. |

---

## Key flows

### CSV import + transaction IDs

Implemented in [`app/account/[id]/import.tsx`](../app/account/[id]/import.tsx) and [`importTransactions`](../src/db/queries.ts) in `queries.ts`.

1. User picks a file via `expo-document-picker`.
2. The account's `column_config` is parsed and passed to [`generic-parser.ts`](../src/parsers/generic-parser.ts) → produces `GenericRow[]`.
3. [`assignTransactionIds`](../src/domain/transaction-id.ts) generates deterministic IDs: `SHA256(accountId | YYYY-MM-DD | amount_cents | normalizedDescription)`. Exact dupes within the same import get a sequence suffix so they each survive.
4. `importTransactions(accountId, batchId, rows)` runs inside a single DB transaction:
   - **Pass 1**: `INSERT OR IGNORE` each row. If the row already existed and the new copy isn't pending, flip `is_pending` from 1→0 (`cleared` counter).
   - **Pass 2**: any `is_pending = 1` row in the date range of this import that wasn't in the new file gets `dropped_at = now` (`dropped` counter — usually pendings that the bank later cancelled).
5. Result counts are written back to `import_batches`.
6. `autoApplyRulesForAccount(accountId)` re-runs rules against newly-uncategorized rows. Returns `ApplyResult { total, byUserRule, byFoundational }` — the Done phase shows the categorized count to the user.
7. The **cached CSV copy** (the URI returned by `DocumentPicker` with `copyToCacheDirectory: true`) is deleted via `FileSystem.deleteAsync({ idempotent: true })`. The original file in the user's Downloads is not touched (iOS doesn't grant write access there). A nudge card prompts the user to open Files app (`shareddocuments://` URL scheme) and delete the original manually.
8. `writeBackup()` snapshots the DB to `Documents/slo-n-ready-backup.json`.

**Why deterministic IDs**: re-importing the same CSV is a no-op (same IDs already in the DB → `INSERT OR IGNORE` skips them). Manual categorization survives re-imports because the row identity is preserved.

### Categorization & rules

Implemented in [`src/domain/rules-engine.ts`](../src/domain/rules-engine.ts) and [`src/domain/foundational-rules.ts`](../src/domain/foundational-rules.ts).

**User rules** (stored in the `rules` table):
- Rules are sorted `priority ASC` and evaluated first-match-wins per transaction.
- Each rule has `logic` (`'AND'`/`'OR'`) over a list of `RuleCondition`. Each condition is one of:
  - text: `contains` / `starts_with` / `ends_with` / `equals` over `normalizeDescription(description)`
  - amount: `amount_eq` / `amount_lt` / `amount_gt` over `amount_cents` (match_text parsed as a dollar string).
- Manual categorization sets `category_set_manually = 1` and clears `applied_rule_id`. After each manual categorization the user can either undo (banner) or — if `accounts.suggest_rules = 1` — be prompted to create a rule from the change.
- Bulk categorization writes inside one DB transaction (`bulkManualSetCategory` / `bulkSetTransactionCategories`).

**Foundational rules** (logic in code; user state in `foundational_rule_settings`):
- Six built-in rules (`FOUNDATIONAL_RULES` in `foundational-rules.ts`): Food & Dining, Groceries, Transportation, Entertainment, Shopping, Health.
- The rule **logic** (conditions, merchant patterns) lives in code, not the DB. User state (which rules are enabled, what category each maps to, per account) lives in `foundational_rule_settings`.
- `getActiveFoundationalRulesAsRules(accountId)` hydrates code-side rules with the account's DB state. SQL filter: `enabled = 1 AND category_id IS NOT NULL`. Returns `Rule`-shaped objects with `id = 'foundational:<rule_id>'`.
- Applied counts are free: `applied_rule_id = 'foundational:food-dining'` is written to the transaction, and the existing `getRuleAppliedCounts` query picks it up by `GROUP BY applied_rule_id`.

**Ordering contract** (never reorder without explicit approval):
```
const merged = [...userRules, ...foundationalRules];
// user rules always run first — foundational rules are the last-resort fallback
```
`autoApplyRulesForAccount` only touches rows where `category_set_manually = 0`. Returns `ApplyResult { total, byUserRule, byFoundational }`.

### Budget grid

Implemented in [`app/account/[id]/budget.tsx`](../app/account/[id]/budget.tsx) using helpers in [`src/domain/budget.ts`](../src/domain/budget.ts) and queries:

- `getBudgetsForAccountYear(accountId, year)` — all 12-month rows for the year.
- `getActualsByCategoryMonth(accountId, year)` — `SUM(amount_cents)` per (category, month) for the actuals overlay.
- `setBudget` writes one cell (or deletes if 0).
- `bulkSetBudgets` and `replaceBudgetsForYear` for row/grid actions in a single transaction.

`splitYearTotal` is the rounding-safe way to distribute an annual amount across 12 months: any rounding remainder is added to the last month so the parts sum exactly to the input.

### Budget vs. actual (Activity / Budget toggle)

An **Activity / Budget toggle** (`ActivityBudgetToggle`) sits near the `MonthPicker` on three screens: home (`app/index.tsx`), account detail (`app/account/[id]/index.tsx`), and all accounts (`app/all.tsx`). Switching to Budget mode replaces the transaction-list content with `BudgetView` (or, on the home screen, replaces each card's `SummaryBar` with `BudgetVarianceSummary`).

Budget data is year-grain (one query per year, cached until the screen loses focus). The month/year picker still drives the comparison — switching months within the same year is free (client-side filter via `monthsInRange`).

Per-category variance is computed by:
1. `buildCategoryRows(budgetRows, actualRows, monthsInRange)` — merges budget and actual data.
2. `computeVarianceSummary(rows)` — aggregates income and expense halves separately.
3. `classifyRow(row)` — sign-of-budget-aware track classification for bar color.

**All-accounts page**: budgets aggregated across accounts by category (`getBudgetsForAllAccountsYear`). Missing per-account budgets treated as $0. **Home screen**: two batched queries (`getBudgetsForAllAccountsYearByAccount`, `getActualsByCategoryMonthAllAccountsByAccount`) return all data in one round-trip; client fans out to per-card summaries.

A **year-to-date chip** appears in Budget view when the selected year is the current calendar year and some months have not elapsed yet, reminding the user that the variance is partial.

### Backup & restore

Implemented in [`src/db/backup.ts`](../src/db/backup.ts).

- `writeBackup()` exports every row of every table as JSON to `Documents/slo-n-ready-backup.json`. Called automatically after imports and account changes; called explicitly from the Backup screen.
- `getBackupInfo()` quickly reads metadata (exists, exported_at, counts) for the home-screen restore banner.
- `readBackupFromPath(uri)` validates a user-picked file and returns parsed `BackupData` (accepts versions 1–4).
- `restoreFromData(data)` deletes all rows in FK-safe order then re-inserts everything inside one transaction. Missing fields from older backup versions are backfilled with safe defaults.
- A **pre-migration** backup runs automatically before any schema change — see `writePreMigrationBackup` in [`src/db/client.ts`](../src/db/client.ts).

### v4 welcome flow (existing users)

Implemented in [`app/index.tsx`](../app/index.tsx), [`app/welcome-v4.tsx`](../app/welcome-v4.tsx), and [`app/welcome-v4-emoji-suggest.tsx`](../app/welcome-v4-emoji-suggest.tsx).

1. `index.tsx` uses a `useFocusEffect` + `welcomeChecked` ref to run **once per session** after data loads.
2. If `accounts.length > 0` and `getPreference('v4_welcomed')` is not `'true'`, pushes `/welcome-v4`.
3. The welcome sheet (`waving` Rachey) lists 3 v4.0 highlights. Two CTAs:
   - **"Suggest emojis for my categories"** → calls `setPreference('v4_welcomed', 'true')` then `router.replace('/welcome-v4-emoji-suggest')`.
   - **"Got it"** → calls `setPreference('v4_welcomed', 'true')` then `router.back()`.
4. `welcome-v4-emoji-suggest` loads categories, runs `suggestEmojisForCategories`, lets the user review/override per row, then saves only changed emojis via `updateCategory`.
5. Once `v4_welcomed = 'true'` is persisted in `app_preferences`, the check on re-open exits immediately — the sheet never shows again.

New users (zero accounts) skip the flow entirely — the home screen empty state handles onboarding.

### App preferences

`app_preferences` is a simple key/value table (see [SCHEMA.md](SCHEMA.md#app_preferences)). Access via `getPreference(key)` and `setPreference(key, value)` in `src/db/queries.ts`. Used for one-time flags like `v4_welcomed`. v4.1 will add `tutorial_completed` and `tutorial_declined`.

---

### Pending vs. cleared vs. dropped

A transaction has three observable states in the data:

| State | Stored as | Counted in summaries? |
|---|---|---|
| Cleared | `is_pending = 0`, `dropped_at = NULL` | Yes |
| Pending | `is_pending = 1`, `dropped_at = NULL` | Yes (counted as expected charges) |
| Dropped | `is_pending = 1`, `dropped_at = <ts>` | **No** — `dropped_at IS NULL` clause filters them out |

Rows are never deleted on drop — keeping the row preserves audit trail and lets a future import un-drop a row that re-appears.

---

## Testing

- `npm test` runs the Jest suite.
- DB and domain logic are tested as pure functions where possible. UI is exercised manually in Expo Go.
- Mocks for Expo modules live under [`tests/__mocks__/`](../tests/__mocks__/) (e.g. `expo-file-system-legacy.ts`).
- When you add a new domain helper or non-trivial query, add a test in the same commit.

**v4.0 test coverage added:**

| File | What it covers |
|---|---|
| `tests/domain/foundational-rules.test.ts` | Shape of each `FoundationalRule`: valid id, non-empty conditions, valid logic, no funFact. Snapshot of IDs prevents silent drift. |
| `tests/domain/rules-engine.test.ts` (extended) | **Ordering contract**: user rule always wins over foundational rule on the same transaction. Proof that array order matters. `byFoundational` count. Disabled and unmapped foundational rules excluded. |
| `tests/domain/emoji-suggestions.test.ts` | 22 cases: known mappings, case-insensitivity, multi-word names, batch function, null for unknown names. |

---

## When you add a new feature

Cross-reference with the ship checklist in [CLAUDE.md](../CLAUDE.md). Specifically:

- New screen → add a row to the **Screens** table above.
- New component → add a row to the **Components** table.
- New domain module → add a row to the **Domain modules** table.
- New flow (or significant change to import/categorization/budget/backup) → update the relevant section under **Key flows**.
- Schema change → update [SCHEMA.md](SCHEMA.md) (it's the source of truth for tables and migrations).
