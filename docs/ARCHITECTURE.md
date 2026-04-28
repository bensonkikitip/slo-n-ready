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
│   ├── _layout.tsx               # Root stack layout, font loading, splash
│   ├── index.tsx                 # Home: list of accounts + combined summary
│   ├── all.tsx                   # All-accounts combined transaction view
│   ├── backup.tsx                # Backup / restore UI
│   ├── categories.tsx            # Category management list
│   ├── account/
│   │   ├── new.tsx               # Create account
│   │   └── [id]/
│   │       ├── index.tsx         # Account detail + transactions
│   │       ├── edit.tsx          # Edit account (name/type/CSV format/columns)
│   │       ├── import.tsx        # CSV import flow
│   │       ├── rules.tsx         # Manage rules for this account
│   │       └── budget.tsx        # Annual budget grid (12 months × categories)
│   └── category/
│       ├── new.tsx               # Create category
│       └── [id]/edit.tsx         # Edit category (name + color)
├── src/
│   ├── db/
│   │   ├── client.ts             # SQLite open + migrations (LATEST_DB_VERSION)
│   │   ├── queries.ts            # All DB operations + TypeScript interfaces
│   │   └── backup.ts             # Backup / restore (writeBackup, restoreFromData)
│   ├── domain/                   # Pure logic, easy to unit-test
│   │   ├── rules-engine.ts       # Rule evaluation + auto-apply
│   │   ├── budget.ts             # Budget math (split, %, annual totals)
│   │   ├── money.ts              # cents ⇄ dollars formatting
│   │   ├── month.ts              # Month/year picker data
│   │   ├── transaction-id.ts     # Deterministic SHA256 IDs
│   │   ├── normalize.ts          # Description + date normalization
│   │   └── category-colors.ts    # 8-swatch color palette
│   ├── components/               # Reusable UI
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
| `rules-engine.ts` | `applyRulesToTransactions(txs, rules) → RuleAssignment[]`, `autoApplyRulesForAccount(accountId)`, `autoApplyAllRules()` | Evaluates each rule's conditions (AND/OR) against a transaction's normalized description and amount. First-match wins (rules are pre-sorted by `priority ASC`). Skips manually-categorized transactions and dropped transactions. |
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
| `/category/new` | `category/new.tsx` | Create category (name + color from 8-swatch palette). |
| `/category/[id]/edit` | `category/[id]/edit.tsx` | Edit category. |

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
| `Sloth` | empty states, splash | Mascot SVGs (meditating, sleeping, laptop, piggyBank). |
| `RacheyBanner` | categories, home, rules, account detail, import, backup | Inline banner: small Rachey pose (52px) + random encouragement line + dismiss ×. Locks pose and line on mount via `useState(() => pickRacheyLine(moment))` so it never re-randomizes mid-render. |

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
6. `autoApplyRulesForAccount(accountId)` re-runs rules against newly-uncategorized rows.
7. `writeBackup()` snapshots the DB to `Documents/slo-n-ready-backup.json`.

**Why deterministic IDs**: re-importing the same CSV is a no-op (same IDs already in the DB → `INSERT OR IGNORE` skips them). Manual categorization survives re-imports because the row identity is preserved.

### Categorization & rules

Implemented in [`src/domain/rules-engine.ts`](../src/domain/rules-engine.ts).

- Rules are sorted `priority ASC` and evaluated first-match-wins per transaction.
- Each rule has `logic` (`'AND'`/`'OR'`) over a list of `RuleCondition`. Each condition is one of:
  - text: `contains` / `starts_with` / `ends_with` / `equals` over `normalizeDescription(description)`
  - amount: `amount_eq` / `amount_lt` / `amount_gt` over `amount_cents` (match_text parsed as a dollar string).
- `autoApplyRulesForAccount(accountId)` only touches rows where `category_set_manually = 0` (so manual picks always win).
- Manual categorization sets `category_set_manually = 1` and clears `applied_rule_id`. After each manual categorization the user can either undo (banner) or — if `accounts.suggest_rules = 1` — be prompted to create a rule from the change.
- Bulk categorization writes inside one DB transaction (`bulkManualSetCategory` / `bulkSetTransactionCategories`).

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
- `readBackupFromPath(uri)` validates a user-picked file and returns parsed `BackupData` (accepts versions 1, 2, 3).
- `restoreFromData(data)` deletes all rows in FK-safe order then re-inserts everything inside one transaction. Missing fields from older backup versions are backfilled with safe defaults.
- A **pre-migration** backup runs automatically before any schema change — see `writePreMigrationBackup` in [`src/db/client.ts`](../src/db/client.ts).

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

- `npm test` runs the Jest suite (`tests/domain/`).
- DB and domain logic are tested as pure functions where possible. UI is exercised manually in Expo Go.
- Mocks for Expo modules live under [`tests/__mocks__/`](../tests/__mocks__/) (e.g. `expo-file-system-legacy.ts`).
- When you add a new domain helper or non-trivial query, add a test in the same commit.

---

## When you add a new feature

Cross-reference with the ship checklist in [CLAUDE.md](../CLAUDE.md). Specifically:

- New screen → add a row to the **Screens** table above.
- New component → add a row to the **Components** table.
- New domain module → add a row to the **Domain modules** table.
- New flow (or significant change to import/categorization/budget/backup) → update the relevant section under **Key flows**.
- Schema change → update [SCHEMA.md](SCHEMA.md) (it's the source of truth for tables and migrations).
