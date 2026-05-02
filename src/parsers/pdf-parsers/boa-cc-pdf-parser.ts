import { normalizeDescription } from '../../domain/normalize';
import { GenericRow } from '../generic-parser';
import { ParsedPdf, PdfSummary, PdfTextItem, SkippedCandidate } from './pdf-types';
import {
  groupByY,
  parseAmountCents,
  parseDateMmDd,
  textOfRow,
} from './pdf-utils';

// ─── Column pre-filter ────────────────────────────────────────────────────────

/**
 * BoA CC statements have extra columns we must strip before groupByY:
 *   Posting Date:         x ≥ 82  && x < 117   (second date column; we use Transaction Date)
 *   Reference Number:     x ≥ 350 && x < 420
 *   Account Number:       x ≥ 420 && x < 490
 *
 * After stripping, useful columns are:
 *   Transaction Date:  x ≤ 50    (MM/DD format)
 *   Description:       x ≥ 117 && x < 350
 *   Amount:            x ≥ 490 && x ≤ 560
 */
function stripBoaCcNoise(items: PdfTextItem[]): PdfTextItem[] {
  return items.filter(i =>
    !(i.x >= 82  && i.x < 117) &&   // Posting Date column
    !(i.x >= 350 && i.x < 490),      // Reference + Account Number columns
  );
}

// ─── BoA CC noise lines ───────────────────────────────────────────────────────

function isBoaCcNoiseLine(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.startsWith('total') ||
    t.startsWith('subtotal') ||
    t.startsWith('page ') ||
    t.startsWith('transactions') ||  // section header (already processed by !inSection block)
    t.startsWith('fees') ||
    t.startsWith('interest') ||
    t === 'purchases' ||              // sub-section header
    t.startsWith('payments') ||       // "Payments and Other Credits" sub-section
    t.includes('balance') ||
    // Column header row after stripping ("Transaction Date Description Amount Total")
    (t.includes('transaction') && t.includes('date') && t.includes('description'))
  );
}

// ─── Year extraction ──────────────────────────────────────────────────────────

/**
 * BoA CC page 2 header contains the statement period:
 *   e.g. "April 27 - May 26, 2025"
 * We scan pages 1–2 for a standalone 4-digit year item (^20\d{2}$).
 */
function extractBoaCcYear(items: PdfTextItem[]): number {
  for (const i of items.filter(p => p.page <= 2).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const m = i.text.trim().match(/^(20\d{2})$/);
    if (m) return parseInt(m[1], 10);
  }
  return new Date().getFullYear();
}

// ─── Summary extraction ───────────────────────────────────────────────────────

/**
 * Look on pages 1–2 for a "Purchases" row with a dollar amount.
 * The label is constructed from the statement period row containing the year.
 */
function extractBoaCcSummary(
  items: PdfTextItem[],
): Pick<PdfSummary, 'label' | 'expectedTotals'> | null {
  // Build label: find the row that contains the 4-digit year on page 2
  let label = '';
  const p2items = items.filter(i => i.page <= 2);
  const p2rows  = groupByY(p2items, 6);
  for (const row of p2rows) {
    if (row.some(c => /^20\d{2}$/.test(c.text.trim()))) {
      label = textOfRow(row);
      break;
    }
  }

  // Find Purchases total
  let purchasesExpected: number | null = null;
  for (const row of p2rows) {
    const t = textOfRow(row).toLowerCase();
    if (t.includes('purchases')) {
      for (const cell of row) {
        const cleaned = cell.text.trim().replace(/^\+/, '');
        const cents = parseAmountCents(cleaned);
        if (cents !== null && cents >= 0) {
          purchasesExpected = cents;
          break;
        }
      }
      if (purchasesExpected !== null) break;
    }
  }

  if (purchasesExpected === null) return null;
  return { label, expectedTotals: { purchases: purchasesExpected } };
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildBoaCcSummary(
  base: Pick<PdfSummary, 'label' | 'expectedTotals'> | null,
  rows: GenericRow[],
): PdfSummary | null {
  if (!base || Object.keys(base.expectedTotals).length === 0) return null;

  const parsedPurchases = rows
    .filter(r => r.amountCents < 0)
    .reduce((s, r) => s + Math.abs(r.amountCents), 0);

  const parsedTotals: Record<string, number> = { purchases: parsedPurchases };
  const expectedPurchases = base.expectedTotals['purchases'] ?? 0;
  const diffCents = Math.abs(parsedPurchases - expectedPurchases);

  return { label: base.label, expectedTotals: base.expectedTotals, parsedTotals, diffCents };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a Bank of America BankAmericard CC PDF statement.
 *
 * Pre-processing:
 *   - Strip Posting Date (x 82–116) and Reference/Account Number (x 350–489) columns.
 *
 * Column thresholds (after stripping):
 *   Transaction Date: x ≤ 50   (format MM/DD, year from statement period header)
 *   Description:      x ≥ 117 && x < 350
 *   Amount:           x ≥ 490 && x ≤ 560
 *                     (positive=purchase→negate; negative=payment→negate→positive)
 *   Y-tolerance:      3.0pt
 */
export function parseBoaCcPdf(items: PdfTextItem[]): ParsedPdf {
  const Y_TOL = 3.0;

  // Pre-filter noise columns
  const cleaned = stripBoaCcNoise(items);

  const docYear     = extractBoaCcYear(cleaned);
  const summaryBase = extractBoaCcSummary(cleaned);

  const rows = groupByY(cleaned, Y_TOL);

  const parsed: GenericRow[] = [];
  const skipped: SkippedCandidate[] = [];

  let inSection    = false;
  let pendingDate: string | null = null;
  let pendingDesc: string[]      = [];
  let lastParsedPage: number | null = null;

  function flushPending(amountCents: number, extraDesc: string = '') {
    if (!pendingDate) return;
    const rawDesc = [...pendingDesc, extraDesc].filter(Boolean).join(' ');
    parsed.push({
      dateIso: pendingDate,
      amountCents,
      description: normalizeDescription(rawDesc),
      originalDescription: rawDesc,
      isPending: false,
    });
    pendingDate = null;
    pendingDesc = [];
  }

  for (const row of rows) {
    const rowText = textOfRow(row);
    const t = rowText.toLowerCase();
    if (!t.trim()) continue;

    // Detect "Transactions" section header on page 3+
    if (!inSection) {
      if (t.startsWith('transactions')) {
        inSection = true;
      }
      continue;
    }

    // Skip noise lines
    if (isBoaCcNoiseLine(t)) {
      if (pendingDate && t.includes('balance')) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }
      continue;
    }

    // ── Find cells ────────────────────────────────────────────────────────────
    const dateCell  = row.find(c => c.x <= 50  && parseDateMmDd(c.text) !== null);
    const amtCell   = row.find(c => c.x >= 490 && c.x <= 560 && parseAmountCents(c.text) !== null);
    const descItems = row.filter(c => c.x >= 117 && c.x < 350);
    const descText  = descItems.map(c => c.text).join(' ').trim();

    if (dateCell) {
      if (pendingDate) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }

      const { mm, dd } = parseDateMmDd(dateCell.text)!;
      const dateIso = `${docYear}-${mm}-${dd}`;

      if (amtCell) {
        // Negate: positive=purchase→expense; negative=payment→income
        const amountCents = -parseAmountCents(amtCell.text)!;
        parsed.push({
          dateIso,
          amountCents,
          description: normalizeDescription(descText),
          originalDescription: descText,
          isPending: false,
        });
        lastParsedPage = dateCell.page;
      } else {
        pendingDate = dateIso;
        pendingDesc = descText ? [descText] : [];
      }
      continue;
    }

    // No date cell — continuation or orphan amount
    if (amtCell) {
      const amountCents = -parseAmountCents(amtCell.text)!;
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
      pendingDesc.push(descText);
    } else if (!pendingDate && descText && parsed.length > 0) {
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

  if (pendingDate) {
    skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
  }

  const summary = buildBoaCcSummary(summaryBase, parsed);
  return { rows: parsed, summary: summary ?? undefined, skippedCandidates: skipped };
}
