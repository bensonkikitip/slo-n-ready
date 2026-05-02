import { normalizeDescription } from '../../domain/normalize';
import { GenericRow } from '../generic-parser';
import { ParsedPdf, PdfSummary, PdfTextItem, SkippedCandidate } from './pdf-types';
import {
  groupByY,
  parseAmountCents,
  parseDateMmDd,
  textOfRow,
} from './pdf-utils';

// ─── Doubled-character noise filter ──────────────────────────────────────────

/**
 * Chase PDFs have header/footer items where every character is repeated, e.g.
 * "MMaannaaggee" instead of "Manage". Detect and pre-filter them so they never
 * pollute groupByY rows.
 *
 * Heuristic: if deduplicating consecutive identical chars halves (or more than
 * halves) the length, the item is doubled-char noise.
 */
function isDoubledCharNoise(text: string): boolean {
  if (text.length < 4) return false;
  const deduped = text.replace(/(.)\1+/g, '$1');
  return deduped.length * 2 <= text.length;
}

// ─── Chase noise lines ────────────────────────────────────────────────────────

function isChaseNoiseLine(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.startsWith('total') ||
    t.startsWith('page ') ||
    t.includes('minimum payment') ||
    t.includes('credit limit') ||
    t.includes('available credit') ||
    t.includes('payment due') ||
    t.includes('beginning balance') ||
    t.includes('ending balance') ||
    // Section header on continuation pages ("ACCOUNT ACTIVITY CONTINUED")
    (t.includes('account') && t.includes('activity'))
  );
}

// ─── Section header detection ─────────────────────────────────────────────────

/**
 * The Chase transaction section starts with a row containing:
 *   "ACCOUNT"  at x < 50
 *   "ACTIVITY" at x ≥ 50 && x < 130
 * Both items must already be non-doubled (i.e., the input has been pre-filtered).
 */
function isChaseSectionHeader(row: PdfTextItem[]): boolean {
  const account  = row.find(c => c.x < 50  && c.text === 'ACCOUNT');
  const activity = row.find(c => c.x >= 50 && c.x < 130 && c.text.startsWith('ACTIVITY'));
  return !!(account && activity);
}

// ─── Year extraction ──────────────────────────────────────────────────────────

/**
 * Look on page 1 for:
 *   1. A standalone 4-digit year item (e.g. "2026").
 *   2. A MM/DD/YY date item (e.g. "01/17/26") — fall back to two-digit year conversion.
 */
function extractChaseYear(items: PdfTextItem[]): number {
  const p1 = items.filter(i => i.page === 1);

  // Prefer an explicit 4-digit year text
  for (const i of p1) {
    const m = i.text.trim().match(/^(20\d{2})$/);
    if (m) return parseInt(m[1], 10);
  }

  // Fall back: find "Opening/Closing Date" items — MM/DD/YY two-digit year
  for (const i of p1.sort((a, b) => b.x - a.x)) { // rightmost = closing date
    const m = i.text.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (m) {
      const yy = parseInt(m[3], 10);
      return yy <= 29 ? 2000 + yy : 1900 + yy;
    }
  }

  return new Date().getFullYear();
}

// ─── Summary extraction ───────────────────────────────────────────────────────

/**
 * The Chase Account Summary on page 1 has a "Purchases" row with a dollar amount
 * like "+$2,157.11" (leading '+' stripped before parsing).
 * X threshold < 250 per plan analysis.
 */
function extractChaseSummary(
  items: PdfTextItem[],
): Pick<PdfSummary, 'label' | 'expectedTotals'> | null {
  // Build label from year text on page 1
  let label = '';
  for (const i of items.filter(p => p.page === 1)) {
    const m = i.text.trim().match(/^(20\d{2})$/);
    if (m) { label = m[1]; break; }
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(i.text.trim())) {
      label = (label ? i.text.trim() + ' ' + label : i.text.trim());
    }
  }

  const p1 = items.filter(i => i.page === 1);
  const rows = groupByY(p1, 6);

  let purchasesExpected: number | null = null;

  for (const row of rows) {
    const rowText = textOfRow(row).toLowerCase();
    if (rowText.includes('purchases')) {
      // Find an amount-like item in this row (strip leading '+')
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

  return {
    label,
    expectedTotals: { purchases: purchasesExpected },
  };
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildChaseSummary(
  base: Pick<PdfSummary, 'label' | 'expectedTotals'> | null,
  rows: GenericRow[],
): PdfSummary | null {
  if (!base || Object.keys(base.expectedTotals).length === 0) return null;

  // Purchases = absolute value of all expense (negative) rows
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
 * Parse a Chase Freedom Unlimited (or similar) CC PDF statement.
 *
 * Pre-processing:
 *   - Remove doubled-character noise items before groupByY.
 *
 * Column thresholds (confirmed against real Chase statements):
 *   Date:        x < 45   (format MM/DD, year from page 1 header)
 *   Description: x ≥ 114 && x < 450
 *   Amount:      x ≥ 450  (positive=purchase→negate; negative=payment→negate→positive)
 *   Y-tolerance: 3.5pt
 */
export function parseChasePdf(items: PdfTextItem[]): ParsedPdf {
  const Y_TOL = 3.5;

  // Pre-filter: remove doubled-char noise items entirely
  const cleaned = items.filter(i => !isDoubledCharNoise(i.text));

  const docYear     = extractChaseYear(cleaned);
  const summaryBase = extractChaseSummary(cleaned);

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

    // Detect ACCOUNT ACTIVITY section header
    if (!inSection) {
      if (isChaseSectionHeader(row)) {
        inSection = true;
      }
      continue;
    }

    // Skip noise lines
    if (isChaseNoiseLine(t)) {
      if (pendingDate && t.includes('ending balance')) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }
      continue;
    }

    // ── Find cells ────────────────────────────────────────────────────────────
    const dateCell  = row.find(c => c.x < 45 && parseDateMmDd(c.text) !== null);
    const amtCell   = row.find(c => c.x >= 450 && parseAmountCents(c.text) !== null);
    const descItems = row.filter(c => c.x >= 114 && c.x < 450);
    const descText  = descItems.map(c => c.text).join(' ').trim();

    if (dateCell) {
      // New transaction — flush any incomplete pending
      if (pendingDate) {
        skipped.push({ rawText: pendingDesc.join(' '), possibleDateIso: pendingDate });
        pendingDate = null;
        pendingDesc = [];
      }

      const { mm, dd } = parseDateMmDd(dateCell.text)!;
      const dateIso = `${docYear}-${mm}-${dd}`;

      if (amtCell) {
        // Chase: negate all amounts (positive=purchase→expense; negative=payment→income)
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
      // Append to last completed transaction only if on the same page
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

  const summary = buildChaseSummary(summaryBase, parsed);
  return { rows: parsed, summary: summary ?? undefined, skippedCandidates: skipped };
}
