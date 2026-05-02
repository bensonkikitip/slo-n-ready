import { PdfTextItem } from '../../../src/parsers/pdf-parsers/pdf-types';

/**
 * Synthetic Chase Freedom Unlimited CC statement for January 2026.
 *
 * *** Y-value convention (same as boa-fixture.ts & axos-fixture.ts) ***
 * Y values use BOTTOM-ORIGIN (y increases upward, like standard PDF coords).
 * Large y = near TOP of page = processed first by groupByY's DESC sort.
 *
 * Key Chase-specific features exercised:
 *   1. Doubled-char noise on page 1 (pre-filtered before groupByY)
 *   2. Year extracted from "January 2026" text on page 1
 *   3. Account Summary "Purchases" total on page 1
 *   4. "ACCOUNT ACTIVITY" section header on page 4 triggers inSection=true
 *   5. Transaction amounts are NEGATED: positive=purchase→expense, negative=payment→income
 *   6. Continuation rows merged into parent transaction (same-page logic)
 *
 * Layout (pages 1 and 4):
 *   TX1: 01/02 purchase  $50.00  STARBUCKS COFFEE NYC  (+ continuation "NEW YORK NY")
 *   TX2: 01/05 purchase  $25.00  AMAZON MARKETPLACE
 *   TX3: 01/10 payment  -$75.00  AUTOPAY PAYMENT THANK YOU
 *
 * Summary totals:
 *   Expected purchases (absolute) = $50.00 + $25.00 = $75.00 = 7 500 cents
 */

function item(page: number, x: number, y: number, text: string): PdfTextItem {
  return { page, x, y, text };
}

// ── Page 1: Year header (non-doubled) ────────────────────────────────────────

const PAGE1_YEAR: PdfTextItem[] = [
  item(1, 200, 740, 'January'),
  item(1, 260, 740, '2026'),
];

// ── Page 1: Doubled-char noise (must be pre-filtered before groupByY) ─────────
// Each text here satisfies: deduplicated.length * 2 <= original.length

const PAGE1_DOUBLED_NOISE: PdfTextItem[] = [
  item(1, 30, 700, 'MMaannaaggee'),    // "Manage"  doubled  (len=12, deduped=6)
  item(1, 100, 700, 'YYoouurr'),       // "Your"    doubled  (len=8,  deduped=4)
  item(1, 160, 700, 'AAccccoouunntt'), // "Account" doubled  (len=14, deduped=7)
];

// ── Page 1: Account summary (non-doubled) ────────────────────────────────────
// Credits/Purchases row — x < 250 per plan

const PAGE1_SUMMARY: PdfTextItem[] = [
  item(1,  40, 540, 'Purchases'),
  item(1, 200, 540, '+$75.00'),  // leading '+' stripped by Chase summary extractor
];

// ── Page 4: ACCOUNT ACTIVITY section header (non-doubled) ────────────────────
// "ACCOUNT" at x<50 and "ACTIVITY" at x<120 together trigger inSection=true

const PAGE4_HEADER: PdfTextItem[] = [
  item(4, 30, 760, 'ACCOUNT'),   // x=30 < 50  ✓
  item(4, 90, 760, 'ACTIVITY'),  // x=90 < 120 ✓
];

// TX1: 01/02 purchase $50.00 — with a continuation row
const TX1: PdfTextItem[] = [
  item(4, 30, 730, '01/02'),
  item(4, 114, 730, 'STARBUCKS'),
  item(4, 175, 730, 'COFFEE'),
  item(4, 225, 730, 'NYC'),
  item(4, 470, 730, '$50.00'),    // positive purchase → negate → -5000 cents
  // Continuation row
  item(4, 114, 716, 'NEW'),
  item(4, 138, 716, 'YORK'),
  item(4, 166, 716, 'NY'),
];

// TX2: 01/05 purchase $25.00
const TX2: PdfTextItem[] = [
  item(4, 30, 700, '01/05'),
  item(4, 114, 700, 'AMAZON'),
  item(4, 168, 700, 'MARKETPLACE'),
  item(4, 470, 700, '$25.00'),    // positive purchase → negate → -2500 cents
];

// TX3: 01/10 payment -$75.00 (credit/payment shown as negative in Chase → negate → positive income)
const TX3: PdfTextItem[] = [
  item(4, 30, 680, '01/10'),
  item(4, 114, 680, 'AUTOPAY'),
  item(4, 166, 680, 'PAYMENT'),
  item(4, 220, 680, 'THANK'),
  item(4, 258, 680, 'YOU'),
  item(4, 470, 680, '-$75.00'),   // negative payment → negate → +7500 cents
];

// ── Full fixture ──────────────────────────────────────────────────────────────

export const CHASE_STATEMENT_ITEMS: PdfTextItem[] = [
  ...PAGE1_YEAR,
  ...PAGE1_DOUBLED_NOISE,
  ...PAGE1_SUMMARY,
  ...PAGE4_HEADER,
  ...TX1,
  ...TX2,
  ...TX3,
];

export const CHASE_EXPECTED = {
  totalTransactions:    3,
  starbucksCents:      -5_000,   // -$50.00 purchase
  amazonCents:         -2_500,   // -$25.00 purchase
  paymentCents:         7_500,   // +$75.00 payment (income)
  totalPurchasesCents:  7_500,   // $75.00 (sum of absolute purchases, from summary)
  diffCents:            0,
};
