#!/usr/bin/env tsx
/**
 * Developer-only: exhaustively test all 720 permutations (6!) of the
 * foundational rule run order to find the ordering that maximises
 * correct categorisation and minimises wrong-category assignments.
 *
 * Scoring (per permutation):
 *   correct  – first-match rule assigns a transaction to its ground-truth category
 *   wrong    – first-match rule assigns a transaction to a DIFFERENT foundational category
 *   uncaught – transaction in a foundational category that no rule matched
 *
 * Score = correct − (3 × wrong)
 *   Penalise wrong assignments 3× more than a miss, because a wrong assignment
 *   actively misfires and confuses the user; a miss just means uncategorised.
 *
 * Usage:
 *   npx tsx scripts/optimize-rule-order.ts [scripts/global-test-backup.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { FOUNDATIONAL_RULES } from '../src/domain/foundational-rules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
interface Backup { transactions: BackupTx[]; categories: BackupCategory[] }

// ---------------------------------------------------------------------------
// Matching — mirrors rules-engine.ts matchesCondition (lowercase .includes)
// ---------------------------------------------------------------------------

function matchesRule(description: string, ruleIdx: number): boolean {
  const lower = (description ?? '').toLowerCase();
  for (const c of FOUNDATIONAL_RULES[ruleIdx].conditions) {
    const pattern = c.match_text.toLowerCase();
    if (!pattern) continue;
    if (lower.includes(pattern)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Permutations
// ---------------------------------------------------------------------------

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) result.push([arr[i], ...p]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const backupPath = process.argv[2] ?? path.join(__dirname, 'global-test-backup.json');
const backup: Backup = JSON.parse(fs.readFileSync(path.resolve(backupPath), 'utf-8'));

// Only care about active transactions
const txs = backup.transactions.filter(t => t.dropped_at == null);

// Map category id → foundational rule index (-1 if not a foundational category)
const catIdToRuleIdx = new Map<string, number>();
for (let i = 0; i < FOUNDATIONAL_RULES.length; i++) {
  const catName = FOUNDATIONAL_RULES[i].defaultCategoryName.toLowerCase();
  const cat = backup.categories.find(c => c.name.toLowerCase() === catName);
  if (cat) catIdToRuleIdx.set(cat.id, i);
}

// Transactions that belong to a foundational category (our ground truth set)
const foundationalTxs = txs.filter(t => t.category_id != null && catIdToRuleIdx.has(t.category_id));

console.log(`Transactions total:           ${txs.length}`);
console.log(`Foundational category txs:    ${foundationalTxs.length}`);
console.log(`Rules:                        ${FOUNDATIONAL_RULES.length}`);
console.log(`Permutations to test:         ${factorial(FOUNDATIONAL_RULES.length)}`);
console.log('');

function factorial(n: number): number { return n <= 1 ? 1 : n * factorial(n - 1); }

// Pre-compute which rule(s) each transaction matches (index into FOUNDATIONAL_RULES)
const txMatches: number[][] = txs.map(tx =>
  FOUNDATIONAL_RULES.map((_, i) => i).filter(i => matchesRule(tx.description, i))
);

// Build result for a given rule order (array of rule indices)
interface PermResult {
  order: number[];                  // rule index sequence
  correct: number;
  wrong: number;
  uncaught: number;
  score: number;
  // Per-category breakdown
  catCorrect: number[];
  catWrong: number[];
  catUncaught: number[];
}

function evaluate(order: number[]): PermResult {
  // Map original rule index → position in this order
  const posOf = new Array<number>(FOUNDATIONAL_RULES.length);
  for (let pos = 0; pos < order.length; pos++) posOf[order[pos]] = pos;

  const catCorrect  = new Array<number>(FOUNDATIONAL_RULES.length).fill(0);
  const catWrong    = new Array<number>(FOUNDATIONAL_RULES.length).fill(0);
  const catUncaught = new Array<number>(FOUNDATIONAL_RULES.length).fill(0);

  for (let t = 0; t < txs.length; t++) {
    const tx = txs[t];
    if (tx.category_id == null || !catIdToRuleIdx.has(tx.category_id)) continue;

    const groundTruthIdx = catIdToRuleIdx.get(tx.category_id)!;
    const matches = txMatches[t]; // rule indices this tx matches

    if (matches.length === 0) {
      catUncaught[groundTruthIdx]++;
      continue;
    }

    // First-match-wins: pick the match with the lowest position in this order
    let firstMatchIdx = -1;
    let firstMatchPos = Infinity;
    for (const ruleIdx of matches) {
      if (posOf[ruleIdx] < firstMatchPos) {
        firstMatchPos = posOf[ruleIdx];
        firstMatchIdx = ruleIdx;
      }
    }

    if (firstMatchIdx === groundTruthIdx) {
      catCorrect[groundTruthIdx]++;
    } else {
      catWrong[groundTruthIdx]++;
    }
  }

  const correct  = catCorrect.reduce((a, b) => a + b, 0);
  const wrong    = catWrong.reduce((a, b) => a + b, 0);
  const uncaught = catUncaught.reduce((a, b) => a + b, 0);
  return { order, correct, wrong, uncaught, score: correct - 3 * wrong, catCorrect, catWrong, catUncaught };
}

// Generate and score all permutations
const ruleIndices = FOUNDATIONAL_RULES.map((_, i) => i);
const allPerms = permutations(ruleIndices);

console.log('Running all permutations...');
const t0 = Date.now();
const results: PermResult[] = allPerms.map(evaluate);
results.sort((a, b) => b.score - a.score || b.correct - a.correct || a.wrong - b.wrong);
console.log(`Done in ${Date.now() - t0}ms\n`);

// ---------------------------------------------------------------------------
// Current order (as defined in foundational-rules.ts)
// ---------------------------------------------------------------------------

const currentOrder = ruleIndices; // 0,1,2,3,4,5 = food,groceries,transport,entertainment,shopping,health
const currentResult = results.find(r => r.order.join() === currentOrder.join())!;

function ruleLabel(idx: number): string { return FOUNDATIONAL_RULES[idx].id; }
function orderLabel(order: number[]): string { return order.map(ruleLabel).join(' → '); }

function printResult(r: PermResult, tag = '') {
  const names = FOUNDATIONAL_RULES.map(r => r.id);
  console.log(`  Order:    ${orderLabel(r.order)}${tag}`);
  console.log(`  Score:    ${r.score}   correct=${r.correct}  wrong=${r.wrong}  uncaught=${r.uncaught}`);
  for (let i = 0; i < FOUNDATIONAL_RULES.length; i++) {
    const tot = r.catCorrect[i] + r.catWrong[i] + r.catUncaught[i];
    const cov = tot === 0 ? 0 : ((r.catCorrect[i] / tot) * 100);
    console.log(`    ${names[i].padEnd(16)} correct=${r.catCorrect[i].toString().padStart(3)}  wrong=${r.catWrong[i].toString().padStart(2)}  uncaught=${r.catUncaught[i].toString().padStart(2)}  coverage=${cov.toFixed(1)}%`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const TOP_N = 10;

console.log('═'.repeat(70));
console.log('CURRENT ORDER');
console.log('═'.repeat(70));
printResult(currentResult, '  ← CURRENT');

const currentRank = results.findIndex(r => r.order.join() === currentOrder.join()) + 1;
console.log(`\n  Rank: ${currentRank} / ${results.length}`);

console.log('\n' + '═'.repeat(70));
console.log(`TOP ${TOP_N} ORDERINGS`);
console.log('═'.repeat(70));

for (let i = 0; i < Math.min(TOP_N, results.length); i++) {
  const r = results[i];
  const isCurrent = r.order.join() === currentOrder.join();
  console.log(`\n#${i + 1}${isCurrent ? ' ← CURRENT' : ''}`);
  printResult(r);

  // Diff vs current
  if (!isCurrent) {
    const gained = r.correct - currentResult.correct;
    const lostWrong = currentResult.wrong - r.wrong;
    console.log(`  Δ vs current: correct ${gained >= 0 ? '+' : ''}${gained}  wrong ${lostWrong >= 0 ? '-' : '+'}${Math.abs(lostWrong)}  score ${r.score >= currentResult.score ? '+' : ''}${r.score - currentResult.score}`);
  }
}

// ---------------------------------------------------------------------------
// Worst orderings for contrast
// ---------------------------------------------------------------------------

console.log('\n' + '═'.repeat(70));
console.log('BOTTOM 3 ORDERINGS (worst)');
console.log('═'.repeat(70));

for (let i = results.length - 3; i < results.length; i++) {
  console.log(`\n#${i + 1}`);
  printResult(results[i]);
}

// ---------------------------------------------------------------------------
// Key insight: which rule MUST come first / last?
// ---------------------------------------------------------------------------

console.log('\n' + '═'.repeat(70));
console.log('POSITIONAL ANALYSIS  (avg score when rule is at each position)');
console.log('═'.repeat(70));

const N = FOUNDATIONAL_RULES.length;
const posScores: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
const posCounts: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

for (const r of results) {
  for (let pos = 0; pos < N; pos++) {
    const ruleIdx = r.order[pos];
    posScores[ruleIdx][pos] += r.score;
    posCounts[ruleIdx][pos]++;
  }
}

const colWidth = 10;
const header = ['Rule'.padEnd(20), ...Array.from({ length: N }, (_, p) => `Pos ${p + 1}`.padStart(colWidth))].join('');
console.log('\n' + header);
console.log('-'.repeat(header.length));

for (let rIdx = 0; rIdx < N; rIdx++) {
  const row = [FOUNDATIONAL_RULES[rIdx].id.padEnd(20)];
  let bestPos = 0;
  let bestAvg = -Infinity;
  for (let pos = 0; pos < N; pos++) {
    const avg = posScores[rIdx][pos] / (posCounts[rIdx][pos] || 1);
    if (avg > bestAvg) { bestAvg = avg; bestPos = pos; }
    row.push(avg.toFixed(1).padStart(colWidth));
  }
  console.log(row.join('') + `   ← best at pos ${bestPos + 1}`);
}

// ---------------------------------------------------------------------------
// Conflict analysis: which rule pairs fight over transactions?
// ---------------------------------------------------------------------------

console.log('\n' + '═'.repeat(70));
console.log('CROSS-RULE CONFLICTS  (transactions matched by 2+ rules)');
console.log('═'.repeat(70));

// For each pair of rules, count how many ground-truth txs BOTH rules match
const pairConflicts: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

for (let t = 0; t < txs.length; t++) {
  const tx = txs[t];
  if (tx.category_id == null || !catIdToRuleIdx.has(tx.category_id)) continue;
  const matches = txMatches[t];
  if (matches.length < 2) continue;
  for (let a = 0; a < matches.length; a++) {
    for (let b = a + 1; b < matches.length; b++) {
      pairConflicts[matches[a]][matches[b]]++;
      pairConflicts[matches[b]][matches[a]]++;
    }
  }
}

let anyConflict = false;
for (let a = 0; a < N; a++) {
  for (let b = a + 1; b < N; b++) {
    if (pairConflicts[a][b] > 0) {
      anyConflict = true;
      console.log(`  ${FOUNDATIONAL_RULES[a].id.padEnd(18)} ↔ ${FOUNDATIONAL_RULES[b].id.padEnd(18)} : ${pairConflicts[a][b]} tx(s) matched by both`);
    }
  }
}
if (!anyConflict) console.log('  (none — rules are perfectly disjoint on the ground-truth set)');

// ---------------------------------------------------------------------------
// RECOMMENDATION
// ---------------------------------------------------------------------------

const best = results[0];
console.log('\n' + '═'.repeat(70));
console.log('RECOMMENDATION');
console.log('═'.repeat(70));
if (best.order.join() === currentOrder.join()) {
  console.log('\n✅  Current order is already optimal.');
} else {
  console.log(`\n  Best order:    ${orderLabel(best.order)}`);
  console.log(`  Current order: ${orderLabel(currentOrder)}`);
  console.log(`  Score delta:   +${best.score - currentResult.score} (correct +${best.correct - currentResult.correct}, wrong -${currentResult.wrong - best.wrong})`);
  console.log('\n  Changes vs current:');
  for (let pos = 0; pos < N; pos++) {
    if (best.order[pos] !== currentOrder[pos]) {
      console.log(`    Position ${pos + 1}: ${ruleLabel(currentOrder[pos])} → ${ruleLabel(best.order[pos])}`);
    }
  }
}
console.log('');
