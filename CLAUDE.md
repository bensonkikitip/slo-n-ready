# BudgetApp — Claude Context

A privacy-first iOS budget tracker (Slo & Ready). All data lives on-device in SQLite — no servers, no sync, no telemetry. Built with Expo + Expo Router + expo-sqlite.

## Where to look (read on demand — do NOT preload)

| When the task involves… | Read this |
|---|---|
| **Database tables, columns, types, migrations, backup format** | [docs/SCHEMA.md](docs/SCHEMA.md) |
| **Code layout, screens, components, domain modules, key flows (import, categorization, budget, backup)** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **Running, building, testing, dev environment** | [README.md](README.md) |

These docs are the source of truth for schema and architecture. **Do not re-derive by reading dozens of files.** Read the doc, then jump to specific source files only when the doc points you there.

## Ship & release checklist

Run before every release. Pre-flight steps are non-negotiable.

### Pre-flight (must pass before anything else)
1. `npm test` — must pass.
2. `npm run typecheck` — must pass.
3. Smoke-test on Expo Go or Simulator: launch the app and navigate to anything you changed.
4. Confirm `slo-n-ready-backup.json` is NOT staged (`git status` should not list it).
5. **Every bug fix that touches `src/db/` must include a regression test under `tests/db/`** that fails on pre-fix code and passes on post-fix code. We've shipped four DB-layer regressions (FK crashes, restore column losses, applied-count zeroes) that integration tests would have caught — this rule exists so we stop. The test runs against an in-memory SQLite via `tests/helpers/db.ts`'s `createTestDb()`; it's fast (~200ms cold).
6. **Run Maestro E2E flows** (simulator must be running with the app open):
   ```
   maestro test maestro/onboarding_new_user.yaml
   maestro test maestro/import_flow.yaml
   maestro test maestro/categorize.yaml
   maestro test maestro/rule_apply.yaml
   maestro test maestro/backup_restore.yaml
   maestro test maestro/period_nav.yaml
   ```
   All 6 flows must pass. Install Maestro once with `brew install maestro` (requires Maestro ≥ 1.38 for iOS file picker support).

### Update docs (mandatory when applicable)
5. **Update `docs/SCHEMA.md`** if any DB change was made:
   - new table / column / index / constraint
   - new `if (version < N)` block in `src/db/client.ts` (`LATEST_DB_VERSION` bumped)
   - new field on a TypeScript interface in `src/db/queries.ts`
   - change to `BackupData` shape in `src/db/backup.ts`
6. **Update `docs/ARCHITECTURE.md`** if any code-organization change was made:
   - new screen under `app/`
   - new component under `src/components/`
   - new domain module under `src/domain/`
   - new key flow or significant change to import / categorization / budget / backup

### If you added a DB migration
7. Confirm the migration is idempotent (`IF NOT EXISTS` / `try/catch` on `ALTER`) and `LATEST_DB_VERSION` was bumped.
8. In `src/db/backup.ts`, update **both** `writeBackup` (export) and `restoreFromData` (import) to handle the new table/column. They must always cover the same set of tables — if you touch one, touch the other.
9. Bump `BackupData.version` in `src/db/backup.ts` if the change is non-additive (drops or renames a field).
10. On a device with pre-migration data: open the app, confirm `slo-n-ready-backup.json` was written, confirm the changed screens load.

### Version & commit
11. Pick the version bump (semver):
    - **MAJOR** — incompatible UX rewrite or breaking schema change
    - **MINOR** — new user-visible feature
    - **PATCH** — bug fixes, copy, assets, additive schema with a clean migration
12. Bump `version` in **both** `app.json` and `package.json` — they must stay in sync.
13. Commit: `vX.Y.Z — <one-line summary>`.

### Tag, push, release
14. Tag and push: `git tag vX.Y.Z && git push origin main --tags`
15. Create the GitHub release: `gh release create vX.Y.Z --title "vX.Y.Z — …" --notes "…" --latest` — summarize features, fixes, and any DB migration in plain language. Tags alone don't show up in the Releases tab — always create the release too.

## EAS / App Store build checklist

Run before every `eas build` attempt. These catch the dependency issues that silently break cloud builds.

### How versioning works (read this once)
- **Marketing version** (`3.1.1` etc.) — you manage this. Bump it in `app.json` AND `package.json` together before building.
- **Build number** (`CFBundleVersion`) — EAS manages this automatically via `appVersionSource: "remote"` + `autoIncrement: true`. Never edit it manually.
- **`ios/SloNReady/Info.plist`** — EAS overwrites `CFBundleShortVersionString` and `CFBundleVersion` from `app.json` on every build. Do not edit the plist manually for version changes.

### Dependency health (run in order)
1. `npx expo-doctor@latest` — must show **17/17 checks passed**. Fix any failures before continuing.
2. `npx expo install --check` — must show **Dependencies are up to date**. If it lists packages to update, run `npx expo install <package>` for each one.
3. Confirm `.npmrc` exists at the project root and contains `legacy-peer-deps=true`. This is required to suppress optional peer dep conflicts from expo-router's web dependencies.

### Config sanity
4. `app.json` and `package.json` must have the **same `version`** value.
5. `app.json` `bundleIdentifier` must be `com.kiip.slonready` (never `com.anonymous.*`).
6. `app.json` must contain an `extra.eas.projectId` field (added by `eas build:configure`).

### Pre-build
7. `npm test` — must pass.
8. `npm run typecheck` — must pass.
9. Commit all changes: `git add -p && git commit` — build from a clean, committed state so the build is traceable.

### Build & submit
10. `eas build --platform ios --profile production` — wait for "Build successful" (~15–25 min).
11. Install via **TestFlight** and smoke-test before submitting to App Store review.
12. `eas submit --platform ios --latest` — pushes the build to App Store Connect.
13. In **App Store Connect**: add the build to the version, fill in "What's New", then click **Submit for Review**.

## Critical conventions (don't violate without asking)

- **Money is always `INTEGER` cents.** Never store dollars as floats. Negative = expense / debit, positive = income / credit. Use `centsToDollars` / `parseDollarsToCents` in `src/domain/money.ts`.
- **Dates are ISO `YYYY-MM-DD` strings.** Months are `YYYY-MM`. Timestamps (`created_at`, `imported_at`, `dropped_at`) are ms since epoch as `INTEGER`.
- **Transaction IDs are deterministic** — SHA256 over `account_id|date|amount|normalized_description` (with a sequence counter for exact dupes). Re-importing the same CSV is safe; never generate random IDs for transactions.
- **Foreign keys are enforced** (`PRAGMA foreign_keys = ON` in `getDb()`). Cascading deletes are intentional — deleting an account wipes its transactions, batches, rules, and budgets.
- **Migrations are forward-only and idempotent.** Each migration block in `src/db/client.ts` is guarded so it's safe to re-run. Bump `LATEST_DB_VERSION` and add a new `if (version < N)` block; do NOT edit historical migrations.
- **Pre-migration auto-backup** runs before any schema change (see `writePreMigrationBackup` in `client.ts`). Don't bypass it.
- **Dropped transactions stay in the DB** with `dropped_at` set — they're filtered out of summaries via `dropped_at IS NULL`, not deleted. This preserves audit trail and lets pendings be un-dropped.
- **`category_set_manually = 1`** means the user picked the category by hand; rule auto-application must skip these rows (`bulkSetTransactionCategories` enforces this in its `WHERE` clause).
- **No new dependencies without asking.** The app is intentionally lean (Expo, expo-sqlite, expo-file-system, papaparse, js-sha256, Nunito font). Adding a new package is a decision, not a default.
- **No network calls, no analytics, no telemetry.** Privacy is a product promise, not a preference.

## User profile

The owner is new to coding ("vibe coding" with Claude). Explain non-obvious decisions, prefer simple readable solutions, and ask before making large or hard-to-reverse changes.
