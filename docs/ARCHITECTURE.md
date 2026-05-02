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
│       └── [id]/
│           ├── edit.tsx          # Edit category (name + color + emoji + description)
│           └── merge.tsx         # Pick a target and merge source → target (atomic)
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
│   │   ├── index.ts              # Parser entry point — exports CSV + PDF parsers
│   │   ├── generic-parser.ts     # CSV → ParsedRow[] using a ColumnConfig
│   │   ├── column-config.ts      # ColumnConfig type + DEFAULT_CONFIGS
│   │   ├── bank-formats.ts       # CSV_FORMATS list (BankFormatEntry[]) — shared by new/edit screens
│   │   └── pdf-parsers/
│   │       ├── pdf-types.ts      # PdfTextItem, ParsedPdf, PdfSummary, SkippedCandidate
│   │       ├── pdf-utils.ts      # groupByY, parseAmountCents, parseDateMmDdYy, etc.
│   │       ├── boa-pdf-parser.ts # Bank of America checking/savings (4-format variants verified)
│   │       ├── boa-cc-pdf-parser.ts  # BoA BankAmericard CC (two-date-column, ref/acct noise strip)
│   │       ├── citi-pdf-parser.ts    # Citi credit card (old/mid/new format + 2 edge cases)
│   │       ├── axos-pdf-parser.ts    # Axos checking/savings (Credits/Debits two-column layout)
│   │       ├── chase-pdf-parser.ts   # Chase Freedom CC (doubled-char noise filter, ACCOUNT ACTIVITY)
│   │       └── generic-pdf-parser.ts # Heuristic fallback for unsupported banks
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
| `month.ts` | `buildYearList`, `buildMonthList`, `monthLabel(key)`, `addMonths(key, n)` | Builds picker entries. Always shows a 6-month window around the latest data even if the DB has gaps. `addMonths` is also used by the Trends screen for period arithmetic. |
| `trends.ts` | `buildTrendRows(current, previous, categories)`, `getRacheyOverallMessage(totalCurrent, totalPrevious)`, `getRacheyCategoryMessage(name, deltaPct)`, `averageSpendingPeriods(periods)` | Spending comparison logic for the Trends screen. `buildTrendRows` merges two periods into `TrendRow[]` sorted by biggest absolute % change. `getRacheyOverallMessage` and `getRacheyCategoryMessage` form the Rachey message library — encouraging copy keyed by category name keywords (food/transport/entertainment/shopping/health) + direction + magnitude. No hardcoded category IDs. `averageSpendingPeriods` averages N period arrays for the "3-month average" mode. Covered by `tests/domain/trends.test.ts`. |
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
| `/account/new` | `account/new.tsx` | Create-account form (name, type, CSV format, optional column override). Also offers a **"Skip CSV — I'll import a statement →"** path: user selects a bank format and skips CSV column setup entirely. Saves the account and navigates straight to `import.tsx?fromOnboarding=1`. |
| `/account/[id]` | `account/[id]/index.tsx` | Transactions for one account. Filter by month/year/category. Bulk-select for batch categorization. Search. Undo banner after a manual categorization. Menu → edit / import / rules / budget. |
| `/account/[id]/edit` | `account/[id]/edit.tsx` | Edit account metadata. Delete account (cascades). |
| `/account/[id]/import` | `account/[id]/import.tsx` | Pick CSV **or PDF statement** → preview → diff reconciliation card (PDF only) → import → show counts. PDF cleanup nudge on done screen. Accepts `fromOnboarding=1` param: changes the done-phase CTA from "Back to Account" to "Set up rules →" which navigates to `/account/[id]?showFoundationalOnboarding=1`. |
| `/account/[id]/add` | `account/[id]/add.tsx` | Manual single-transaction entry form (date, amount, description). Accepts optional `prefillDate`, `prefillAmount`, `prefillDescription` params for pre-populating from the PDF diff reconciliation flow. Saves via `insertManualTransaction`, then auto-applies rules and writes backup. |
| `/account/[id]/rules` | `account/[id]/rules.tsx` | List rules in priority order; drag to reorder; tap to edit; create with multi-condition support (AND/OR over text + amount conditions). |
| `/account/[id]/budget` | `account/[id]/budget.tsx` | Annual budget grid: sticky months across, categories down. Cells editable; row & global actions (split annual total, fill from previous year, apply %, copy). Actuals overlay shows real spend per cell. |
| `/category/new` | `category/new.tsx` | Create category (name + color + optional emoji + optional description). Exports `CATEGORY_EMOJIS` constant used by the emoji picker. |
| `/category/[id]/edit` | `category/[id]/edit.tsx` | Edit category (name + color + emoji + description). "Merge into another category →" secondary button pushes to the merge screen. |
| `/category/[id]/merge` | `category/[id]/merge.tsx` | List of all other categories; tap to confirm and execute a merge. Calls `mergeCategory(sourceId, targetId)` then replaces to `/`. |
| `/welcome-v4` | `welcome-v4.tsx` | Modal. Shown once to existing users after upgrading from v3.x (checked via `app_preferences.v4_welcomed`). Rachey waving. Lists 3 new v4.0 features. Two CTAs: emoji suggest or dismiss. Writes `v4_welcomed = "true"` and never shows again. |
| `/welcome-v4-emoji-suggest` | `welcome-v4-emoji-suggest.tsx` | Modal. Loads all categories + emoji suggestions; user reviews/overrides per row; saves changed emojis in one pass. Skippable. |
| `/onboarding/intro` | `onboarding/intro.tsx` | First-time user landing screen. Rachey waving + slogan + 1 CTA → categories step. Triggered by `app/index.tsx` when zero accounts AND zero categories AND `intro_completed` not set. |
| `/onboarding/categories` | `onboarding/categories.tsx` | Checklist of 10 starter categories (all checked). Tap a row to inline-edit name + emoji. Uncheck to skip. "Save & continue" bulk-inserts checked rows via `bulkInsertCategories`, sets `intro_completed = "true"`, replaces to `/account/new`. |
| `/onboarding/foundational-rules` | `onboarding/foundational-rules.tsx` | Per-account foundational rules sheet. Pushed from `app/account/[id]/index.tsx` when `?showFoundationalOnboarding=1` is set AND no `foundational_rule_settings` rows exist for the account. Lists 6 foundational rules with category dropdown + enable toggle. First account: pre-fills by name match against `defaultCategoryName`. 2nd+ account: copies from oldest other account. Accept → `bulkUpsertFoundationalRuleSettings` + `autoApplyRulesForAccount` → `/onboarding/done`. Skip → all rows written with `enabled=0` so the screen doesn't re-fire → `router.back()`. |
| `/onboarding/done` | `onboarding/done.tsx` | Congrats screen after foundational rules apply. Shows "X transactions categorized!" using a `firstFoundationalCategorization` Rachey moment. CTA → replace to `/account/${accountId}`. |
| `/trends` | `trends.tsx` | Spending Trends screen. Three comparison modes: vs last month (default), vs same month last year (only shown when data spans > 11 months), vs 3-month average. Shows Rachey's overall message card (`RacheyInsightCard`) plus a sorted list of per-category rows (`TrendCategoryRow`). For categories with a spending goal set, a goal-status pill shows under/over. Empty state when no comparison data is available. Accessible via "Trends" button in the home screen header. |

---

## Components (`src/components/`)

| Component | Used in | Purpose |
|---|---|---|
| `SummaryBar` | home, account detail, all | Horizontal income (green) + expense (terracotta) + net bar. Optional `excludedCents` prop (v4.6): when non-zero renders a second row `↔ $X.XX not counted toward totals` below the bar. |
| `TransactionRow` | account detail, all | Date, description, amount, category badge, pending/dropped flags. Tap to categorize. Renders a `↔` pill when the category has `exclude_from_totals = 1`. |
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
| `CsvBrowserTip` | account/new, account/[id]/import | Inline tip card explaining that users on iPhone need to use Safari (not their bank's app) to download a CSV — most banking apps don't expose CSV export. Links to `/csv-guide` for per-bank steps. Generic copy (not bank-specific). Added in v4.6.2. |
| `SplashSlogan` | `_layout.tsx` (root overlay) | Animated branded card shown on every cold launch. Displays Rachey in `meditating` pose + 3-line slogan. Visible for 800 ms, then fades over 400 ms. `pointerEvents="none"` — never blocks input. Mounts as an absolute overlay over the Stack; `_layout.tsx` hides it via `showSplash` state when `onDone` fires. |
| `TrendCategoryRow` | `app/trends.tsx` | Single category comparison row. Left side: emoji + category name + Rachey micro-comment. Right side: current period $ (bold) + previous period $ (muted) + Δ% badge. Badge is green for down-spending (good), terracotta for up-spending, gray for same. |
| `RacheyInsightCard` | `app/trends.tsx` | Overall period comparison card. Rachey illustration (waving = good news, piggyBank = neutral/no data) + overall message + divider + two-column totals bar (current period total vs previous period total with Δ pill). |

---

## Key flows

### PDF import + diff reconciliation (v4.7.0 / extended v4.8.0)

Implemented in [`app/account/[id]/import.tsx`](../app/account/[id]/import.tsx) (PDF path) and `src/parsers/pdf-parsers/`.

1. User taps **"Choose PDF Statement…"**. The native `PdfExtractorModule` (Swift PDFKit, `modules/pdf-extractor/`) extracts word-level `{page, x, y, text}` items. **Coordinate convention**: `y = 0` is the bottom of the page; large `y` values are near the top. `groupByY` sorts items descending (`b.y - a.y`) so top-of-page items (section headers) are processed first.
2. Parser routing by `account.csv_format`:
   - `boa_checking_v1` / `boa_savings_v1` → `parseBoaPdf`
   - `citi_cc_v1` → `parseCitiPdf`
   - `boa_cc_v1` → `parseBoaCcPdf`
   - `axos_checking_v1` / `axos_savings_v1` → `parseAxosPdf`
   - `chase_cc_v1` → `parseChasePdf`
   - `custom` / fallback → `parseGenericPdf`
3. Each parser returns `ParsedPdf { rows: GenericRow[], summary?: PdfSummary, skippedCandidates: SkippedCandidate[] }`. `PdfSummary` holds `expectedTotals` extracted from the statement's own Account Summary section and `diffCents` (0 = perfect match).
4. **Diff reconciliation preview**: if `diffCents > 0` or there are `skippedCandidates`, an amber warning card shows the diff amount and each skipped line with an **"Add manually →"** CTA. Tapping pushes to `/account/[id]/add?prefillDate=…&prefillAmount=…&prefillDescription=…`.
5. **Zero-diff**: a green "✓ All transactions matched" badge appears on the file header card.
6. Confirm import runs the same `importTransactions` pipeline as the CSV flow.
7. The cached PDF copy is deleted via `FileSystem.deleteAsync`. A nudge card prompts the user to delete the original from Files app.

**Native module** (`modules/pdf-extractor/`): requires `npx expo prebuild && pod install`. Not available in Expo Go — the PDF button shows an informational alert if the native module is absent.

**Sign conventions by parser**:
- BoA checking/savings: amounts kept as-is (deposits positive, withdrawals negative in the PDF).
- BoA CC: all amounts negated — purchases are positive in PDF → negative expenses in app; payments are negative in PDF → positive credits.
- Citi CC: all amounts negated (same as BoA CC).
- Axos: Credits column (x≥480 && x≤535) → positive (income); Debits column (x≥540) → negated (expense).
- Chase CC: all amounts negated — purchases are positive in PDF → negative expenses; payments are negative in PDF → positive credits.
- Generic: amounts kept as-is (heuristic, no summary comparison).

**Onboarding import path (v4.8.0)**: `import.tsx` accepts a `fromOnboarding=1` URL param. When set, the pick-phase shows a "Skip & set up rules →" ghost button and the done-phase CTA becomes "Set up rules →" which navigates to `/account/${accountId}?showFoundationalOnboarding=1` instead of going back.

### Manual transaction entry (v4.7.0)

Screen: [`app/account/[id]/add.tsx`](../app/account/[id]/add.tsx)

- Accessible from the **split FAB "+" button** on the account detail screen, the **"Add Manually" menu item**, or pushed programmatically from the PDF diff reconciliation flow with pre-filled params.
- Calls `insertManualTransaction(accountId, dateIso, amountCents, description)` which creates a singleton `manual-{accountId}` batch via `INSERT OR IGNORE` (no schema migration needed). Transaction IDs are deterministic — re-entering the same (date, amount, description) triplet is silently deduplicated.
- Post-save: `autoApplyRulesForAccount`, then `writeBackupSafe`, then `router.back()`.

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
- Applied counts are free: `applied_rule_id = 'foundational:food-dining'` is written to the transaction (the FK on this column was dropped in migration 12 so synthetic IDs persist), and the existing `getRuleAppliedCounts` query picks it up by `GROUP BY applied_rule_id`.

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

### Spending Trends

Implemented in [`app/trends.tsx`](../app/trends.tsx) using [`src/domain/trends.ts`](../src/domain/trends.ts) and [`getCategorySpendingForMonth`](../src/db/queries/budgets.ts).

The screen compares two time periods: the most recent month with data (current) vs. a selectable comparison period.

**Three comparison modes:**
- **vs last month** (default) — `addMonths(currentMonth, -1)`
- **vs same month last year** — `addMonths(currentMonth, -12)` — only shown if the DB has > 11 months of data
- **vs 3-month average** — `averageSpendingPeriods([p1, p2, p3])` client-side from three `getCategorySpendingForMonth` calls

**Data flow:**
1. `getDistinctMonths()` determines the most recent month and whether the "last year" pill should appear.
2. `getCategorySpendingForMonth(month)` returns `{category_id, total_cents}[]` for any month (single SQL query: `SUM(amount_cents) GROUP BY category_id`).
3. `buildTrendRows(current, previous, categories)` merges the two period arrays into `TrendRow[]` (one per category that appears in either period), with `delta_pct` computed as `(|current| − |previous|) / |previous|`. Sorted by biggest absolute `delta_pct` first.
4. `getRacheyOverallMessage` and `getRacheyCategoryMessage` inject Rachey's copy — encouraging regardless of direction.
5. `getBudgetsForAllAccountsYear` provides spending goal data for the goal-status pill overlay (under / slightly over / over).

**Terminology:** UI uses "spending goal" everywhere. The DB table is `budgets` and the code symbols (`budgetRows`, `viewMode === 'budget'`, etc.) stay unchanged — renaming them is a migration risk for no user benefit. The future goal-setting feature will use the word "targets."

### Budget vs. actual (Activity / Goals toggle)

An **Activity / Goals toggle** (`ActivityBudgetToggle`) sits near the `MonthPicker` on three screens: home (`app/index.tsx`), account detail (`app/account/[id]/index.tsx`), and all accounts (`app/all.tsx`). Switching to Goals mode replaces the transaction-list content with `BudgetView` (or, on the home screen, replaces each card's `SummaryBar` with `BudgetVarianceSummary`).

> **Note:** The toggle's UI label changed from "Budget" → "Goals" in v4.4.0 (per the terminology lock above). Internal code symbols and the DB table name remain `budget` / `budgets`.

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

New users (zero accounts) get the FTUE flow below instead — the welcome-v4 sheet only fires for existing users.

### First-time user experience (v4.1)

Implemented in [`app/onboarding/`](../app/onboarding/) (4 screens) plus trigger logic in `app/index.tsx`, `app/account/new.tsx`, and `app/account/[id]/index.tsx`. Source-of-truth constants in [`src/domain/starter-categories.ts`](../src/domain/starter-categories.ts) and [`src/domain/foundational-rules.ts`](../src/domain/foundational-rules.ts).

**Flow A — first-time user (zero accounts AND zero categories):**

```
home (empty) → /onboarding/intro → /onboarding/categories
  → /account/new
      ├─ CSV path: pick CSV file → /account/[id] (after inline import)
      │      → /onboarding/foundational-rules?accountId=X&first=1
      │            → accept: apply rules → /onboarding/done → /account/[id]
      │            → skip: enabled=0 rows written → /account/[id]
      └─ Statement path: select bank format → "Skip CSV — I'll import a statement →"
             → /account/[id]/import?fromOnboarding=1
                   → import PDF/CSV statement → "Set up rules →"
                   → /account/[id]?showFoundationalOnboarding=1
                   → /onboarding/foundational-rules?accountId=X&first=1
                         → accept / skip → same as CSV path above
```

**Flow B — adding 2nd, 3rd, n+1 account:**

```
home → /account/new → /account/[id]
  → /onboarding/foundational-rules?accountId=X (first=0; pre-filled from oldest account)
    → accept / skip → same as Flow A
```

**Trigger gates:**

| Where | Condition |
|---|---|
| `app/index.tsx` `useFocusEffect` (intro) | `accounts.length === 0 && categories.length === 0` → `router.push('/onboarding/intro')`. No `intro_completed` check — zero accounts AND zero categories always means setup is needed regardless of any stale preference. Guarded by an `introChecked` ref so it fires once per session. Order matters: intro check runs **before** the welcome-v4 check; the two are mutually exclusive (intro requires 0 accounts, welcome-v4 requires >0). |
| `app/account/new.tsx` after `insertAccount` | Always appends `?showFoundationalOnboarding=1` to `router.replace`. |
| `app/account/[id]/index.tsx` `useFocusEffect` | If `showFoundationalOnboarding === '1'` AND `getFoundationalRuleSettingsForAccount(id).length === 0` → `router.push('/onboarding/foundational-rules?accountId=X&first=…')`. Param is cleared via `router.setParams({ showFoundationalOnboarding: undefined })` and a ref guards against re-fire. |
| `app/onboarding/categories.tsx` `handleContinue` | Sets `intro_completed = "true"` so the intro never re-triggers, even if the user later deletes everything. |

**Pre-fill logic** (`app/onboarding/foundational-rules.tsx`):

1. Look up the user's oldest OTHER account (excluding the current one). If it has any `foundational_rule_settings` rows, copy them.
2. Otherwise (this is the first account, or the older account never had settings): for each `FoundationalRule`, find the user's category whose `name.toLowerCase()` matches `defaultCategoryName.toLowerCase()`. The starter category names are intentionally aligned with the foundational rules' default names so this matching always succeeds for the 6 rule-backed buckets.

**Skip persistence:** Tapping "Skip for now" writes all 6 settings with `enabled=0`. Because the trigger checks `existing.length > 0`, the screen never re-fires for that account. The user enables foundational rules later from `/account/[id]/rules`.

### App preferences

`app_preferences` is a simple key/value table (see [SCHEMA.md](SCHEMA.md#app_preferences)). Access via `getPreference(key)` and `setPreference(key, value)` in `src/db/queries.ts`. Used for one-time flags:
- `v4_welcomed` — set after the existing-user welcome sheet dismisses (v4.0)
- `intro_completed` — set after the first-time user finishes the categories onboarding step (v4.1)

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
- DB queries run against a real in-memory SQLite via `better-sqlite3` (test-only). The mock at [`tests/__mocks__/expo-sqlite.ts`](../tests/__mocks__/expo-sqlite.ts) implements `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`, and `withTransactionAsync` against `better-sqlite3` so FK enforcement and `PRAGMA` behavior match production.
- The file-system mock at [`tests/__mocks__/expo-file-system-legacy.ts`](../tests/__mocks__/expo-file-system-legacy.ts) is in-memory; backup tests can read what they wrote without touching disk.
- Use [`tests/helpers/db.ts`](../tests/helpers/db.ts)'s `createTestDb()` in `beforeEach`. It calls `jest.resetModules()`, resets both mocks, and re-requires `client` / `queries` / `backup` / `rulesEngine` — so every test starts on a fresh, fully-migrated DB. Always call query functions through the returned modules, not via top-level imports (those would point at a stale singleton).
- DB tests live under [`tests/db/`](../tests/db/); domain/parser tests stay where they are.
- E2E flows are in `maestro/` and run against a live simulator with `maestro test maestro/<flow>.yaml`. They test complete user journeys (onboarding, import, categorization, rules, backup, period navigation) against the real app — no mocking. Requires Maestro 2.5.0+ (install: `curl -Ls "https://get.maestro.mobile.dev" | bash`). The import flows use dev-only "Load … .csv" fixture buttons in the import screen (`__DEV__` + pick phase only) to bypass the iOS document picker, which Maestro cannot drive for arbitrary file types. Fixture CSV data lives in [`src/test/fixtures.ts`](../src/test/fixtures.ts). Synthetic sample PDFs for onboarding are under `maestro/fixtures/`. See the ship checklist in [CLAUDE.md](../CLAUDE.md) for which flows must pass before each release.

**Coverage map:**

| Folder | What's covered |
|---|---|
| `tests/db/migrations.test.ts` | All 12 migrations apply cleanly; FKs are on; `applied_rule_id` has no FK (regression for v4.2.0). |
| `tests/db/backup.test.ts` | Full export → import round-trip across all 8 tables; sidecar metadata; legacy fallback; v3 forward-compat. |
| `tests/db/import-transactions.test.ts` | Bulk insert, idempotent re-import, pending→cleared, dropped-pending detection within the date-range window, chunked imports. |
| `tests/db/rules.test.ts` | `applied_rule_id` contract; foundational counts; manual-skip; deleteRule clears the FK replacement; `autoApplyAllRules` parallel total. |
| `tests/domain/foundational-rules.test.ts` | Shape of each `FoundationalRule`: valid id, non-empty conditions, valid logic, no funFact. Snapshot of IDs prevents silent drift. |
| `tests/domain/rules-engine.test.ts` | **Ordering contract**: user rule always wins over foundational rule on the same transaction. Proof that array order matters. `byFoundational` count. Disabled and unmapped foundational rules excluded. |
| `tests/domain/emoji-suggestions.test.ts` | 22 cases: known mappings, case-insensitivity, multi-word names, batch function, null for unknown names. |

---

## When you add a new feature

Cross-reference with the ship checklist in [CLAUDE.md](../CLAUDE.md). Specifically:

- New screen → add a row to the **Screens** table above.
- New component → add a row to the **Components** table.
- New domain module → add a row to the **Domain modules** table.
- New flow (or significant change to import/categorization/budget/backup) → update the relevant section under **Key flows**.
- Schema change → update [SCHEMA.md](SCHEMA.md) (it's the source of truth for tables and migrations).
