import { PdfTextItem } from '../../../src/parsers/pdf-parsers/pdf-types';

/**
 * Synthetic Axos Rewards Checking statement for January 2026.
 *
 * *** Y-value convention (same as boa-fixture.ts) ***
 * Y values use BOTTOM-ORIGIN (y increases upward, like standard PDF coords).
 * Large y = near TOP of page = processed first by groupByY's DESC sort.
 * This allows section headers (large y) to be found before transactions.
 *
 * Layout (page 1 then page 2):
 *   TX1: 01/07 credit  $132.88  From: Business Checking *0849
 *   TX2: 01/16 debit   $154.00  ALLIANT IN ALLIANT INTERNAT
 *   TX3: 01/26 debit   $500.00  EPAY CHASE CREDIT CRD
 *   TX4: 01/30 credit  $500.00  AXOS BANK transfer
 *
 * Summary totals:
 *   Credits = $132.88 + $500.00 = $632.88
 *   Debits  = $154.00 + $500.00 = $654.00
 */

function item(page: number, x: number, y: number, text: string): PdfTextItem {
  return { page, x, y, text };
}

// ── Page 1 ────────────────────────────────────────────────────────────────────

const PAGE1_PERIOD: PdfTextItem[] = [
  // Statement period: "01/01/2026 thru 02/01/2026" — near top, large y
  item(1, 398, 790, '01/01/2026'),
  item(1, 445, 790, 'thru'),
  item(1, 460, 790, '02/01/2026'),
];

const PAGE1_SUMMARY: PdfTextItem[] = [
  // "Statement Summary" section header
  item(1,  90, 760, 'Statement'),
  item(1, 146, 760, 'Summary'),
  // Table header row: "Deposit Accounts  Beginning Balance  Credits  Debits  Ending Balance"
  item(1,  58, 742, 'Deposit'),
  item(1,  86, 742, 'Accounts'),
  item(1, 262, 742, 'Beginning'),
  item(1, 297, 742, 'Balance'),
  item(1, 391, 742, 'Credits'),
  item(1, 483, 742, 'Debits'),
  item(1, 538, 742, 'Ending'),
  item(1, 563, 742, 'Balance'),
  // Data row: Rewards Checking with totals
  item(1,  58, 726, 'Rewards'),
  item(1,  88, 726, 'Checking'),
  item(1, 294, 726, '$843.95'),    // Beginning Balance
  item(1, 384, 726, '$632.88'),    // Credits total
  item(1, 474, 726, '$654.00'),    // Debits total
  item(1, 560, 726, '$822.83'),    // Ending Balance
  // DEPOSIT TOTALS row (same amounts)
  item(1,  58, 710, 'DEPOSIT'),
  item(1,  89, 710, 'TOTALS'),
  item(1, 294, 710, '$843.95'),
  item(1, 384, 710, '$632.88'),
  item(1, 474, 710, '$654.00'),
  item(1, 560, 710, '$822.83'),
];

const PAGE1_SECTION: PdfTextItem[] = [
  // Account sub-header (noise)
  item(1,  90, 692, 'Rewards'),
  item(1, 127, 692, 'Checking'),
  item(1, 166, 692, '-'),
  item(1, 171, 692, '100002000204'),
  // Beginning Balance row (noise)
  item(1, 457, 678, 'Beginning'),
  item(1, 492, 678, 'Balance'),
  item(1, 560, 678, '$843.95'),
  // Column header row — triggers inSection = true
  item(1,  58, 662, 'Date'),
  item(1, 120, 662, 'Description'),
  item(1, 496, 662, 'Credits'),
  item(1, 568, 662, 'Debits'),
];

// TX1: 01/07 credit $132.88 — date+amount in same row (complete transaction)
const TX1: PdfTextItem[] = [
  item(1,  58, 644, '01/07'),
  item(1, 120, 644, 'From:'),
  item(1, 141, 644, 'Business'),
  item(1, 172, 644, 'Checking'),
  item(1, 204, 644, '*0849'),
  item(1, 489, 644, '$132.88'),   // credit column x≈489
  // Continuation row (description extra detail)
  item(1, 120, 630, 'To:'),
  item(1, 131, 630, 'Checking'),
  item(1, 163, 630, '*0204'),
];

// TX2: 01/16 debit $154.00 — date+amount in same row
const TX2: PdfTextItem[] = [
  item(1,  58, 614, '01/16'),
  item(1, 120, 614, 'ALLIANT'),
  item(1, 148, 614, 'IN'),
  item(1, 157, 614, 'ALLIANT'),
  item(1, 186, 614, 'INTERNAT'),
  item(1, 560, 614, '$154.00'),   // debit column x≈560
  // Continuation rows
  item(1, 120, 600, 'WEB'),
  item(1, 137, 600, '091000015583347'),
];

// ── Page 2 ────────────────────────────────────────────────────────────────────

const PAGE2_HEADER: PdfTextItem[] = [
  // Repeat of statement period (page header noise)
  item(2, 398, 790, '01/01/2026'),
  item(2, 445, 790, 'thru'),
  item(2, 460, 790, '02/01/2026'),
  // Account section repeat
  item(2,  90, 766, 'Rewards'),
  item(2, 127, 766, 'Checking'),
  item(2, 166, 766, '-'),
  item(2, 171, 766, '100002000204'),
  // Column headers (re-triggers section detection, already inSection — no harm)
  item(2,  58, 750, 'Date'),
  item(2, 120, 750, 'Description'),
  item(2, 496, 750, 'Credits'),
  item(2, 568, 750, 'Debits'),
];

// TX3: 01/26 debit $500.00 — date+amount in same row
const TX3: PdfTextItem[] = [
  item(2,  58, 732, '01/26'),
  item(2, 120, 732, 'EPAY'),
  item(2, 148, 732, 'CHASE'),
  item(2, 173, 732, 'CREDIT'),
  item(2, 199, 732, 'CRD'),
  item(2, 560, 732, '$500.00'),   // debit
  item(2, 120, 718, 'WEB'),
  item(2, 137, 718, '021000029500754'),
];

// TX4: 01/30 credit $500.00 — date+amount in same row
const TX4: PdfTextItem[] = [
  item(2,  58, 702, '01/30'),
  item(2, 120, 702, '2601301639'),
  item(2, 168, 702, 'AXOS'),
  item(2, 187, 702, 'BANK'),
  item(2, 489, 702, '$500.00'),   // credit
  item(2, 120, 688, 'WEB'),
  item(2, 137, 688, '122287250043631'),
];

const PAGE2_NOISE: PdfTextItem[] = [
  // Ending Balance (noise — isAxosNoiseLine catches this)
  item(2, 468, 672, 'Ending'),
  item(2, 492, 672, 'Balance'),
  item(2, 560, 672, '$822.83'),
  // Interest section (noise)
  item(2,  90, 650, 'Interest'),
  item(2, 123, 650, 'Earned'),
  item(2, 162, 636, 'Interest'),
  item(2, 189, 636, 'Earned'),
  item(2, 214, 636, 'this'),
  item(2, 228, 636, 'Month'),
  item(2, 300, 636, '$0.00'),
];

// ── Full fixture ──────────────────────────────────────────────────────────────

export const AXOS_STATEMENT_ITEMS: PdfTextItem[] = [
  ...PAGE1_PERIOD,
  ...PAGE1_SUMMARY,
  ...PAGE1_SECTION,
  ...TX1,
  ...TX2,
  ...PAGE2_HEADER,
  ...TX3,
  ...TX4,
  ...PAGE2_NOISE,
];

export const AXOS_EXPECTED = {
  totalTransactions: 4,
  businessCheckingCents:  13_288,   // +$132.88 credit
  alliantCents:          -15_400,   // -$154.00 debit
  epayChaseCents:        -50_000,   // -$500.00 debit
  axosBankCents:          50_000,   // +$500.00 credit
  totalCreditsCents:      63_288,   // $632.88
  totalDebitsCents:       65_400,   // $654.00
  diffCents:              0,
};
