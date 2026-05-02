#!/usr/bin/env tsx
/**
 * Developer-only analysis tool for the foundational-rules system.
 *
 * Reads a local backup JSON, measures how well a foundational rule's
 * `contains` patterns cover the user's actual transactions, and lets us vet
 * candidate patterns before promoting them into FOUNDATIONAL_RULES.
 *
 * NEVER ships to end users — privacy-first app, local-only data, hardcoded
 * patterns per release. This is a design-time authoring aid.
 *
 * Usage:
 *   npx tsx scripts/analyze-foundational.ts coverage <ruleId> <backup.json> [--category=<name>]
 *   npx tsx scripts/analyze-foundational.ts miss     <ruleId> <topN> <backup.json> [--category=<name>]
 *   npx tsx scripts/analyze-foundational.ts vet      <ruleId> <pattern> <backup.json> [--category=<name>]
 *   npx tsx scripts/analyze-foundational.ts user-rules <backup.json> [--category=<name>]
 *
 * The matching logic mirrors src/domain/rules-engine.ts:matchesCondition
 * (lowercase + .includes). If runtime matching ever changes, update this too.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FOUNDATIONAL_RULES, FoundationalRule } from '../src/domain/foundational-rules';

interface BackupTx {
  id: string;
  account_id: string;
  description: string;
  amount_cents: number;
  category_id: string | null;
  category_set_manually: number;
  dropped_at: number | null;
}

interface BackupCategory { id: string; name: string }

interface BackupRule {
  id: string;
  account_id: string;
  category_id: string;
  match_type: string;
  match_text: string;
  conditions: string;
  logic: 'AND' | 'OR';
}

interface Backup {
  transactions: BackupTx[];
  categories:   BackupCategory[];
  rules:        BackupRule[];
}

function loadBackup(p: string): Backup {
  const raw = fs.readFileSync(path.resolve(p), 'utf-8');
  return JSON.parse(raw);
}

function getRule(ruleId: string): FoundationalRule {
  const rule = FOUNDATIONAL_RULES.find(r => r.id === ruleId);
  if (!rule) {
    const ids = FOUNDATIONAL_RULES.map(r => r.id).join(', ');
    throw new Error(`Unknown ruleId "${ruleId}". Known: ${ids}`);
  }
  return rule;
}

function resolveCategoryId(
  backup: Backup,
  rule: FoundationalRule,
  override?: string,
): { id: string; name: string } {
  const wanted = (override ?? rule.defaultCategoryName).toLowerCase();
  const exact   = backup.categories.find(c => c.name.toLowerCase() === wanted);
  if (exact) return { id: exact.id, name: exact.name };
  const fuzzy   = backup.categories.find(c => c.name.toLowerCase().includes(wanted));
  if (fuzzy) return { id: fuzzy.id, name: fuzzy.name };
  const all = backup.categories.map(c => c.name).join(', ');
  throw new Error(
    `No category found matching "${override ?? rule.defaultCategoryName}". ` +
    `Pass --category=<name>. Available: ${all}`
  );
}

// Matches the lowercase .includes semantics of src/domain/rules-engine.ts
function matchesAnyCondition(description: string, rule: FoundationalRule): string | null {
  const lower = (description ?? '').toLowerCase();
  for (const c of rule.conditions) {
    const pattern = c.match_text.toLowerCase();
    if (!pattern) continue;
    switch (c.match_type) {
      case 'contains':    if (lower.includes(pattern))   return c.match_text; break;
      case 'starts_with': if (lower.startsWith(pattern)) return c.match_text; break;
      case 'ends_with':   if (lower.endsWith(pattern))   return c.match_text; break;
      case 'equals':      if (lower === pattern)         return c.match_text; break;
    }
  }
  return null;
}

function descriptionMatchesPattern(description: string, pattern: string): boolean {
  return (description ?? '').toLowerCase().includes(pattern.toLowerCase());
}

// Filter txs: not dropped (active rows only)
function activeTxs(b: Backup): BackupTx[] {
  return b.transactions.filter(t => t.dropped_at == null);
}

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.+)$/.exec(a);
    if (m) flags[m[1]] = m[2];
    else positional.push(a);
  }
  return { positional, flags };
}

// ----------------------------------------------------------------------------
// Sub-commands
// ----------------------------------------------------------------------------

function cmdCoverage(ruleId: string, backupPath: string, categoryOverride?: string) {
  const backup = loadBackup(backupPath);
  const rule   = getRule(ruleId);
  const cat    = resolveCategoryId(backup, rule, categoryOverride);

  const txs       = activeTxs(backup);
  const inCat     = txs.filter(t => t.category_id === cat.id);
  const matched   = inCat.filter(t => matchesAnyCondition(t.description, rule) != null);
  const coverage  = inCat.length === 0 ? 0 : (matched.length / inCat.length) * 100;

  // FP: tx in OTHER category that the rule would still match.
  // Excludes category_set_manually=1 (user explicitly overrode — foundational
  // rules skip those at runtime, so they're not active conflicts).
  const fps = txs.filter(t =>
    t.category_id != null &&
    t.category_id !== cat.id &&
    !t.category_set_manually &&
    matchesAnyCondition(t.description, rule) != null
  );

  console.log(`Rule:                ${rule.id}  (${rule.name})`);
  console.log(`Patterns:            ${rule.conditions.length}`);
  console.log(`Backup file:         ${backupPath}`);
  console.log(`Target category:     ${cat.name} (${cat.id})`);
  console.log(`Total active txs:    ${txs.length}`);
  console.log(`Txs in category:     ${inCat.length}`);
  console.log(`Matched by rule:     ${matched.length}`);
  console.log(`Coverage:            ${coverage.toFixed(1)}%`);
  console.log(`False positives:     ${fps.length} (tx in another category that this rule would catch)`);
  if (fps.length > 0 && fps.length <= 25) {
    console.log(`\nFP details:`);
    const byPattern = new Map<string, BackupTx[]>();
    for (const t of fps) {
      const pat = matchesAnyCondition(t.description, rule)!;
      if (!byPattern.has(pat)) byPattern.set(pat, []);
      byPattern.get(pat)!.push(t);
    }
    const catName = (id: string) => backup.categories.find(c => c.id === id)?.name ?? '(unknown)';
    for (const [pat, list] of byPattern) {
      console.log(`  ${pat} → ${list.length} fp(s):`);
      for (const t of list.slice(0, 3)) {
        console.log(`    [${catName(t.category_id!)}] ${t.description}`);
      }
      if (list.length > 3) console.log(`    ... +${list.length - 3} more`);
    }
  }
}

function cmdMiss(ruleId: string, topN: number, backupPath: string, categoryOverride?: string) {
  const backup = loadBackup(backupPath);
  const rule   = getRule(ruleId);
  const cat    = resolveCategoryId(backup, rule, categoryOverride);
  const txs    = activeTxs(backup).filter(t => t.category_id === cat.id);

  const uncovered = txs.filter(t => matchesAnyCondition(t.description, rule) == null);
  const counts = new Map<string, number>();
  for (const t of uncovered) {
    const key = (t.description ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);

  console.log(`Top ${topN} uncovered descriptions in "${cat.name}" not matched by ${ruleId}:`);
  console.log(`(${uncovered.length} total uncovered tx, ${counts.size} distinct descriptions)\n`);
  for (const [desc, n] of sorted) {
    console.log(`  ${n.toString().padStart(4)}  ${desc}`);
  }
}

function cmdVet(ruleId: string, pattern: string, backupPath: string, categoryOverride?: string) {
  const backup = loadBackup(backupPath);
  const rule   = getRule(ruleId);
  const cat    = resolveCategoryId(backup, rule, categoryOverride);
  const txs    = activeTxs(backup);

  const inCat  = txs.filter(t => t.category_id === cat.id);
  const others = txs.filter(t => t.category_id != null && t.category_id !== cat.id);

  const tp = inCat.filter(t  => descriptionMatchesPattern(t.description, pattern));
  // FP excludes user manual overrides (foundational rule won't touch them at runtime).
  const fp = others.filter(t =>
    !t.category_set_manually && descriptionMatchesPattern(t.description, pattern)
  );

  // Of TPs, how many are NEW (not already caught by current foundational patterns)?
  const newTp = tp.filter(t => matchesAnyCondition(t.description, rule) == null);

  console.log(`Pattern:           "${pattern}"`);
  console.log(`Target category:   ${cat.name}`);
  console.log(`TP (in category):  ${tp.length}  (NEW catches: ${newTp.length})`);
  console.log(`FP (other cats):   ${fp.length}`);

  if (newTp.length > 0) {
    const sample = [...new Set(newTp.map(t => t.description))].slice(0, 5);
    console.log(`\n  New TP sample:`);
    for (const d of sample) console.log(`    ${d}`);
  }
  if (fp.length > 0) {
    const catName = (id: string) => backup.categories.find(c => c.id === id)?.name ?? '(unknown)';
    const fpByCat = new Map<string, BackupTx[]>();
    for (const t of fp) {
      const cn = catName(t.category_id!);
      if (!fpByCat.has(cn)) fpByCat.set(cn, []);
      fpByCat.get(cn)!.push(t);
    }
    console.log(`\n  FP breakdown:`);
    for (const [cn, list] of fpByCat) {
      console.log(`    [${cn}] x${list.length}`);
      for (const t of list.slice(0, 2)) console.log(`      ${t.description}`);
    }
  }
}

function cmdUserRules(backupPath: string, categoryOverride?: string) {
  const backup = loadBackup(backupPath);
  if (!categoryOverride) {
    console.log('Usage: user-rules <backup.json> --category=<name>');
    process.exit(1);
  }
  const cat = resolveCategoryId(backup, FOUNDATIONAL_RULES[0], categoryOverride);
  const rules = backup.rules.filter(r => r.category_id === cat.id);
  console.log(`User rules targeting "${cat.name}" (${rules.length} rules):\n`);
  for (const r of rules) {
    let conds: any[] = [];
    try { conds = JSON.parse(r.conditions || '[]'); } catch {}
    if (conds.length === 0) {
      console.log(`  [${r.match_type}] ${r.match_text}`);
    } else {
      console.log(`  [${r.logic}] ${conds.map((c: any) => `${c.match_type}:${c.match_text}`).join(' / ')}`);
    }
  }
}

// ----------------------------------------------------------------------------

function main() {
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseFlags(rest);
  const cat = flags.category;

  switch (cmd) {
    case 'coverage': {
      const [ruleId, backupPath] = positional;
      if (!ruleId || !backupPath) { console.log('coverage <ruleId> <backup.json> [--category=<name>]'); process.exit(1); }
      cmdCoverage(ruleId, backupPath, cat);
      break;
    }
    case 'miss': {
      const [ruleId, topNStr, backupPath] = positional;
      if (!ruleId || !topNStr || !backupPath) { console.log('miss <ruleId> <topN> <backup.json> [--category=<name>]'); process.exit(1); }
      cmdMiss(ruleId, parseInt(topNStr, 10), backupPath, cat);
      break;
    }
    case 'vet': {
      const [ruleId, pattern, backupPath] = positional;
      if (!ruleId || !pattern || !backupPath) { console.log('vet <ruleId> <pattern> <backup.json> [--category=<name>]'); process.exit(1); }
      cmdVet(ruleId, pattern, backupPath, cat);
      break;
    }
    case 'user-rules': {
      const [backupPath] = positional;
      if (!backupPath) { console.log('user-rules <backup.json> --category=<name>'); process.exit(1); }
      cmdUserRules(backupPath, cat);
      break;
    }
    default:
      console.log('Subcommands: coverage | miss | vet | user-rules');
      console.log('  coverage   <ruleId> <backup.json> [--category=<name>]');
      console.log('  miss       <ruleId> <topN> <backup.json> [--category=<name>]');
      console.log('  vet        <ruleId> <pattern> <backup.json> [--category=<name>]');
      console.log('  user-rules <backup.json> --category=<name>');
      process.exit(1);
  }
}

main();
