import { PdfTextItem } from '../../../src/parsers/pdf-parsers/pdf-types';

/**
 * Synthetic BoA BankAmericard CC statement for April 27 – May 26, 2025.
 *
 * *** Y-value convention ***
 * Y values use BOTTOM-ORIGIN (y increases upward, like standard PDF coords).
 * Large y = near TOP of page = processed first by groupByY's DESC sort.
 *
 * Key BoA CC features exercised:
 *   1. Year extracted from statement period on page 2 ("2025")
 *   2. Account summary "Purchases $150.00" on page 2
 *   3. "Transactions" header on page 3 triggers inSection=true
 *   4. Posting Date column (x≈82) is PRE-STRIPPED before groupByY
 *   5. Reference Number / Account Number columns (x≈358, 417) are PRE-STRIPPED
 *   6. Transaction amounts are NEGATED: positive=purchase→expense, negative=payment→income
 *   7. Section sub-headers ("Purchases", "Payments…") are skipped as noise
 *   8. Continuation rows merged into parent (same-page logic)
 *
 * Layout (pages 2 and 3):
 *   TX1: 05/01 purchase $100.00  WHOLE FOODS MARKET (+ continuation "SAN FRANCISCO CA")
 *   TX2: 05/05 purchase  $50.00  AMAZON MARKETPLACE
 *   TX3: 05/10 payment  -$150.00 PAYMENT RECEIVED   (negative in PDF → negate → income)
 *
 * Summary totals:
 *   Expected purchases (absolute) = $100.00 + $50.00 = $150.00 = 15 000 cents
 */

function item(page: number, x: number, y: number, text: string): PdfTextItem {
  return { page, x, y, text };
}

// ── Page 2: Statement period ──────────────────────────────────────────────────
// "April 27 - May 26, 2025" — the year item is used by extractBoaCcYear

const PAGE2_PERIOD: PdfTextItem[] = [
  item(2, 197, 760, 'April'),
  item(2, 220, 760, '27'),
  item(2, 234, 760, '-'),
  item(2, 243, 760, 'May'),
  item(2, 260, 760, '26,'),
  item(2, 280, 760, '2025'),
];

// ── Page 2: Account summary ───────────────────────────────────────────────────
// "Purchases  150.00" row — used for summary reconciliation

const PAGE2_SUMMARY: PdfTextItem[] = [
  item(2,  40, 720, 'Purchases'),
  item(2, 200, 720, '150.00'),
];

// ── Page 3: Section headers (noise) ──────────────────────────────────────────

const PAGE3_SECTIONS: PdfTextItem[] = [
  // "Transactions" header → triggers inSection=true
  item(3, 36, 760, 'Transactions'),
  // "Purchases" sub-header → noise
  item(3, 36, 730, 'Purchases'),
];

// TX1: 05/01 purchase $100.00
// Posting Date (x=82) and Reference Number (x=358) are present in raw fixture
// but will be PRE-STRIPPED by the parser (x ≥ 82 && x < 117 / x ≥ 350 && x < 490).
const TX1: PdfTextItem[] = [
  item(3,  36, 710, '05/01'),     // Transaction Date  x=36  ≤ 50  ✓
  item(3,  82, 710, '05/03'),     // Posting Date      x=82  → STRIPPED
  item(3, 120, 710, 'WHOLE'),     // Description
  item(3, 148, 710, 'FOODS'),
  item(3, 180, 710, 'MARKET'),
  item(3, 358, 710, '24356789'),  // Reference Number  x=358 → STRIPPED
  item(3, 497, 710, '100.00'),    // Amount            x=497 ≥ 490 ✓
  // Continuation row
  item(3, 120, 696, 'SAN'),
  item(3, 138, 696, 'FRANCISCO'),
  item(3, 192, 696, 'CA'),
];

// TX2: 05/05 purchase $50.00
const TX2: PdfTextItem[] = [
  item(3,  36, 680, '05/05'),
  item(3,  82, 680, '05/07'),     // Posting Date → STRIPPED
  item(3, 120, 680, 'AMAZON'),
  item(3, 165, 680, 'MARKETPLACE'),
  item(3, 358, 680, '98765432'),  // Reference Number → STRIPPED
  item(3, 497, 680, '50.00'),
];

// "Payments and Other Credits" sub-header.
// "and" at x=100 is in the Posting Date strip range (82–116) → stripped.
// Remaining text after strip: "Payments Other Credits" → caught by noise filter.
const PAGE3_PAYMENTS_HEADER: PdfTextItem[] = [
  item(3,  36, 650, 'Payments'),
  item(3, 100, 650, 'and'),       // x=100 → STRIPPED (82 ≤ 100 < 117)
  item(3, 118, 650, 'Other'),
  item(3, 147, 650, 'Credits'),
];

// TX3: 05/10 payment -$150.00
// Negative amount in PDF → negate → positive (income)
const TX3: PdfTextItem[] = [
  item(3,  36, 630, '05/10'),
  item(3,  82, 630, '05/12'),     // Posting Date → STRIPPED
  item(3, 120, 630, 'PAYMENT'),
  item(3, 167, 630, 'RECEIVED'),
  item(3, 358, 630, '11223344'),  // Reference Number → STRIPPED
  item(3, 497, 630, '-150.00'),   // Negative payment → negate → +15 000 cents
];

// ── Full fixture ──────────────────────────────────────────────────────────────

export const BOA_CC_STATEMENT_ITEMS: PdfTextItem[] = [
  ...PAGE2_PERIOD,
  ...PAGE2_SUMMARY,
  ...PAGE3_SECTIONS,
  ...TX1,
  ...TX2,
  ...PAGE3_PAYMENTS_HEADER,
  ...TX3,
];

export const BOA_CC_EXPECTED = {
  totalTransactions:    3,
  wholeFoodsCents:    -10_000,    // -$100.00 purchase
  amazonCents:         -5_000,    // -$50.00  purchase
  paymentCents:        15_000,    // +$150.00 payment (income)
  totalPurchasesCents: 15_000,    // $150.00 (absolute sum, from summary)
  diffCents:           0,
};
