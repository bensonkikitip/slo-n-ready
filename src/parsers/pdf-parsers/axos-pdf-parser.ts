import { normalizeDescription } from '../../domain/normalize';
import { GenericRow } from '../generic-parser';
import { ParsedPdf, PdfSummary, PdfTextItem, SkippedCandidate } from './pdf-types';
import {
  groupByY,
  parseAmountCents,
  parseDateMmDd,
  textOfRow,
} from './pdf-utils';

// ─── Noise detection ──────────────────────────────────────────────────────────

function isAxosNoiseLine(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('ending balance') ||
    t.includes('beginning balance') ||
    t.startsWith('statement summary') ||
    t.startsWith('deposit accounts') ||
    t.startsWith('deposit totals') ||
    t.startsWith('interest earned') ||
    t.startsWith('total for this period') ||
    t.startsWith('annual percentage') ||
    t.startsWith('average daily') ||
    t.startsWith('statement period') ||
    t.startsWith('account #') ||
    t.startsWith('page ') ||
    t.startsWith('fees') ||
    // Column header row
    (t.includes('date') && t.includes('description') && t.includes('credits'))
  );
}

// ─── Year extraction ──────────────────────────────────────────────────────────

/**
 * Axos page 1 header: "01/01/2026  thru  02/01/2026"
 * The closing date (second MM/DD/YYYY item) gives us the year.
 * No y-axis filter: PDF coords are bottom-origin (large y = top), so we sort
 * descending by y then ascending by x to get the two period dates in left-to-right order.
 */
function extractAxosYear(items: PdfTextItem[]): number {
  const periodItems = items
    .filter(i => i.page === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.text))
    .sort((a, b) => b.y - a.y || a.x - b.x); // top of page first, then left to right
  if (periodItems.length >= 2) {
    return parseInt(periodItems[1].text.slice(-4), 10);
  }
  if (periodItems.length === 1) {
    return parseInt(periodItems[0].text.slice(-4), 10);
  }
  return new Date().getFullYear();
}

// ─── Summary extraction ───────────────────────────────────────────────────────

/**
 * The Axos Statement Summary table on page 1:
 *   "Rewards Checking   $843.95   $632.88   $654.00   $822.83"
 *    ^begin             ^x≈294    ^x≈384    ^x≈474    ^x≈560
 *                       BeginBal  Credits   Debits    EndBal
 *
 * We find the DEPOSIT TOTALS row (or the account row) and pick up the
 * Credits amount (x 350–440) and Debits amount (x 455–530).
 */
function extractAxosSummary(items: PdfTextItem[]): Pick<PdfSummary, 'label' | 'expectedTotals'> | null {
  // Scan all of page 1 — no y filter needed; we detect rows by text content.
  // PDF coords are bottom-origin so groupByY processes the summary table (high y)
  // before any transaction rows.
  const page1 = items.filter(i => i.page === 1);
  const rows = groupByY(page1, 6);

  let creditsExpected: number | null = null;
  let debitsExpected: number | null = null;
  let label = '';

  // Find statement period label — MM/DD/YYYY on page 1, largest y first, then left to right
  const periodItems = items
    .filter(i => i.page === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.text))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  if (periodItems.length >= 2) {
    label = `${periodItems[0].text} – ${periodItems[1].text}`;
  }

  for (const row of rows) {
    const rowText = textOfRow(row).toLowerCase();
    // Look for DEPOSIT TOTALS row or any row with 4 dollar amounts
    if (rowText.includes('totals') || rowText.includes('checking') || rowText.includes('savings')) {
      const creditsCell = row.find(c => c.x >= 350 && c.x <= 440 && parseAmountCents(c.text) !== null);
      const debitsCell  = row.find(c => c.x >= 455 && c.x <= 530 && parseAmountCents(c.text) !== null);
      if (creditsCell && debitsExpected === null) creditsExpected = parseAmountCents(creditsCell.text);
      if (debitsCell  && creditsExpected !== null) debitsExpected = parseAmountCents(debitsCell.text);
      if (creditsExpected !== null && debitsExpected !== null) break;
    }
  }

  if (creditsExpected === null && debitsExpected === null) return null;

  const expectedTotals: Record<string, number> = {};
  if (creditsExpected !== null) expectedTotals['credits'] = creditsExpected;   // positive
  if (debitsExpected  !== null) expectedTotals['debits']  = debitsExpected;    // positive in PDF (we negate when parsing)

  return { label, expectedTotals };
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildAxosSummary(
  base: Pick<PdfSummary, 'label' | 'expectedTotals'> | null,
  rows: GenericRow[],
): PdfSummary | null {
  if (!base || Object.keys(base.expectedTotals).length === 0) return null;

  const parsedCredits = rows
    .filter(r => r.amountCents > 0)
    .reduce((s, r) => s + r.amountCents, 0);
  const parsedDebits = rows
    .filter(r => r.amountCents < 0)
    .reduce((s, r) => s + Math.abs(r.amountCents), 0); // compare as positive

  const parsedTotals: Record<string, number> = {
    credits: parsedCredits,
    debits: parsedDebits,
  };

  const expectedCredits = base.expectedTotals['credits'] ?? 0;
  const expectedDebits  = base.expectedTotals['debits']  ?? 0;

  const diffCents =
    Math.abs(parsedCredits - expectedCredits) +
    Math.abs(parsedDebits  - expectedDebits);

  return { label: base.label, expectedTotals: base.expectedTotals, parsedTotals, diffCents };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse an Axos bank account PDF statement (Checking or Savings).
 *
 * Column thresholds (confirmed against real Axos statements):
 *   Date:        x < 80   (format MM/DD, year from statement period header)
 *   Description: x ≥ 120 && x < 480   (multi-line with pending state)
 *   Credits:     x ≥ 480 && x ≤ 535   (positive → income)
 *   Debits:      x ≥ 540              (positive in PDF → negate → expense)
 *   Y-tolerance: 4.0pt
 */
export function parseAxosPdf(items: PdfTextItem[]): ParsedPdf {
  const Y_TOL = 4.0;

  const docYear = extractAxosYear(items);
  const summaryBase = extractAxosSummary(items);

  const rows = groupByY(items, Y_TOL);

  const parsed: GenericRow[] = [];
  const skipped: SkippedCandidate[] = [];

  // Only process rows once we've seen the transaction section header
  // (the "Date Description Credits Debits" column header row)
  let inSection = false;

  // Pending state: date found but no amount yet (multi-line transaction)
  let pendingDate: string | null = null;
  let pendingDesc: string[] = [];

  // Track the page of the most recently completed transaction so we can safely
  // append same-page continuation rows (e.g. "WEB 091000015583347") to it without
  // accidentally picking up repeated page headers on subsequent pages.
  let lastParsedPage: number | null = null;

  function flushPending(amountCents: number, extraDesc: string = '') {
    if (!pendingDate) return;
    const rawDesc = [...pendingDesc, extraDesc].filter(Boolean).join(' ');
    const description = normalizeDescription(rawDesc);
    parsed.push({ dateIso: pendingDate, amountCents, description, originalDescription: rawDesc, isPending: false });
    pendingDate = null;
    pendingDesc = [];
  }

  for (const row of rows) {
    const rowText = textOfRow(row);
    const t = rowText.toLowerCase();
    if (!t.trim()) continue;

    // Detect the transaction section header row
    if (!inSection) {
      if (t.includes('date') && t.includes('description') &&
          (t.includes('credits') || t.includes('debits'))) {
        inSection = true;
      }
      continue;
    }

    // Skip noise lines within the transaction section
    if (isAxosNoiseLine(t)) {
      // Flush any open pending if we're about to skip a block
      if (pendingDate && (t.includes('ending balance') || t.startsWith('interest'))) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }
      continue;
    }

    // ── Find cells ────────────────────────────────────────────────────────────
    const dateCell   = row.find(c => c.x < 80   && parseDateMmDd(c.text) !== null);
    const creditCell = row.find(c => c.x >= 480  && c.x <= 535 && parseAmountCents(c.text) !== null);
    const debitCell  = row.find(c => c.x >= 540  && parseAmountCents(c.text) !== null);
    const descItems  = row.filter(c => c.x >= 120 && c.x < 480);
    const descText   = descItems.map(c => c.text).join(' ').trim();

    if (dateCell) {
      // New transaction starts — flush any unfinished pending as skipped
      if (pendingDate) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }

      const { mm, dd } = parseDateMmDd(dateCell.text)!;
      const dateIso = `${docYear}-${mm}-${dd}`;

      if (creditCell) {
        const amountCents = parseAmountCents(creditCell.text)!; // positive (income)
        parsed.push({ dateIso, amountCents, description: normalizeDescription(descText), originalDescription: descText, isPending: false });
        lastParsedPage = dateCell.page;
      } else if (debitCell) {
        const amountCents = -parseAmountCents(debitCell.text)!; // negate (expense)
        parsed.push({ dateIso, amountCents, description: normalizeDescription(descText), originalDescription: descText, isPending: false });
        lastParsedPage = dateCell.page;
      } else {
        // Amount on a subsequent row — start pending
        pendingDate = dateIso;
        pendingDesc = descText ? [descText] : [];
      }
      continue;
    }

    // No date cell — continuation row or orphan amount
    if (creditCell || debitCell) {
      const amountCents = creditCell
        ? parseAmountCents(creditCell.text)!
        : -parseAmountCents(debitCell!.text)!;
      if (pendingDate) {
        flushPending(amountCents, descText);
        lastParsedPage = row[0]?.page ?? null;
      } else {
        skipped.push({ rawText: rowText, possibleAmountCents: amountCents });
      }
      continue;
    }

    // Description continuation row
    if (pendingDate && descText) {
      // Pending transaction: accumulate extra description lines
      pendingDesc.push(descText);
    } else if (!pendingDate && descText && parsed.length > 0) {
      // Completed transaction on the same page: append to its description.
      // Restricting to same-page prevents repeated page headers (period header,
      // account sub-header) on subsequent pages from being falsely appended.
      const currentPage = row[0]?.page ?? null;
      if (currentPage !== null && currentPage === lastParsedPage) {
        const last = parsed[parsed.length - 1];
        const merged = last.originalDescription + ' ' + descText;
        parsed[parsed.length - 1] = {
          ...last,
          originalDescription: merged,
          description: normalizeDescription(merged),
        };
      }
    }
  }

  // Flush any remaining open pending
  if (pendingDate) {
    skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
  }

  const summary = buildAxosSummary(summaryBase, parsed);
  return { rows: parsed, summary: summary ?? undefined, skippedCandidates: skipped };
}
