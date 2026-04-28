# Slo N Ready

**Take it Slow, Do it Steady, Become Ready...zZ**

A budget tracker for people who hate budgeting. You set the pace — Rachey does the boring parts. All your data lives on your phone, never on a server.

## Mission

Most budget apps punish you for falling behind. Slo N Ready doesn't. It's designed for the anxious, the avoidant, the "I'll deal with it later" crowd. You can import one CSV, let Rachey sort what she recognizes, and walk away. Come back when you're ready. No streaks. No nags. No judgment.

## Privacy & security

- **All data on your phone.** SQLite only. Zero servers, zero sync, zero telemetry.
- **No account or card numbers stored** — stripped at parse time. We only keep date, amount, and description.
- **No analytics, no ad SDKs, no tracking of any kind.**
- **Your backups go to iCloud** automatically via iOS Files — only you can read them.
- **CSVs are deleted from the app** right after import. They never needed to stick around.
- **No network requests** — the app makes no outbound connections of its own.

## How it works

1. **Add an account** — Checking or Credit Card, pick your bank format.
2. **Import a CSV** — export from your bank, pick the file. Rachey handles the rest.
3. **Rachey sorts what she recognizes** — built-in rules cover hundreds of common merchants. You control which rules are on and what category they map to.
4. **Fill in the rest at your own pace** — tap any transaction to assign a category. Or don't. No deadline.
5. **Set budgets (optional)** — plan monthly targets per category for the full year. See actual spend alongside your targets.

## What it does

- Add **Checking** and **Credit Card** accounts
- Import CSVs from your bank — duplicate-safe (re-uploading the same CSV never creates duplicate transactions)
- View **income / expenses / net** for each account, by month or year, across all accounts combined
- Pending transactions flagged separately; dropped pendings preserved for audit
- **Categories** — create color-coded, emoji-tagged categories with descriptions
- **Rules** — auto-categorize on import using text or amount-based rules with AND / OR logic; drag to set priority
- **Foundational rules** — Rachey's built-in merchant recognition; enable per account, map to any category
- **Budget grid** — plan monthly budgets per category for the full year; see actual spend alongside your targets
- **Backup & restore** — export a full backup to Files / AirDrop; restore from any previous backup file

## Supported CSV formats

| Format key | Bank |
|---|---|
| `boa_checking_v1` | Bank of America – Checking |
| `citi_cc_v1` | Citi – Credit Card |

Adding a new bank format means adding one entry to `src/parsers/` and registering it in `src/parsers/index.ts`.

## Tech stack

- [Expo](https://expo.dev) (managed, SDK 54) + [Expo Router](https://expo.github.io/router/docs/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — local SQLite, never leaves the device
- [expo-document-picker](https://docs.expo.dev/versions/latest/sdk/document-picker/) + [expo-file-system](https://docs.expo.dev/versions/latest/sdk/filesystem/) — CSV file access
- [papaparse](https://www.papaparse.com/) — CSV parsing
- [js-sha256](https://github.com/emn178/js-sha256) — deterministic transaction IDs
- [Nunito](https://fonts.google.com/specimen/Nunito) — 400 / 600 / 700 / 800 weights

## Running locally

```bash
# Install dependencies
npm install

# Start the dev server (open in Expo Go on your iPhone)
npx expo start

# Run unit tests
npm test

# TypeScript check
npm run typecheck
```

You'll need [Expo Go](https://expo.dev/go) on your iPhone, or a connected iOS Simulator.

## What's coming

v4.1 and beyond — planned in separate conversations before any build begins:
- Guided tutorial (5-screen walkthrough)
- Settings screen
- More bank CSV formats
- Spending anomaly detection
