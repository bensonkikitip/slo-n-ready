#!/usr/bin/env python3
"""
generate-sample-pdfs.py
=======================
Generates two synthetic bank statement PDFs for use in testing and App Store review:

  maestro/fixtures/sample_boa_statement.pdf   — Bank of America checking (fake data)
  maestro/fixtures/sample_citi_statement.pdf  — Citi credit card (fake data, old format)

Column positions are chosen to match the TypeScript parser thresholds exactly:

  BoA:
    Date:           x = 40   (parser: x < 85)
    Description:    x = 91+  (parser: 85 ≤ x ≤ 525)
    Amount:         x = 530  (parser: x > 525)
    Check left-amt: x = 260  (parser: 230 < x < 330)
    Check right-dt: x = 360  (parser: 330 < x < 420)

  Citi (old format):
    Date:           x = 40   (parser: x < 85)
    Description:    x = 91+  (parser: x ≥ 155, actually 91 works since desc filter is ≥ 155)
    Amount:         x = 370  (parser: 340 ≤ x ≤ 413)
    Sidebar noise:  x = 430+ (parser strips x > 412 before processing)

PDFKit extracts text with bounds.minX = drawn x (±font-kerning). The normalization
in PdfExtractorModule.swift is:  y_normalized = pageHeight - bounds.minY
So text drawn at reportlab y=740 (from bottom) on an 792pt page yields y_normalized = 52.
The parsers use only relative y differences (groupByY tolerance = 4pt), so absolute
y values don't matter — only that same-row items share the same y and rows are >4pt apart.

Run:
  python3 scripts/generate-sample-pdfs.py
"""

import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import LETTER

PAGE_W, PAGE_H = LETTER  # 612 x 792 pt

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'maestro', 'fixtures')

# ── Helpers ───────────────────────────────────────────────────────────────────

def row_y(page_y_from_top: float) -> float:
    """Convert 'points from top of page' to reportlab y (from bottom)."""
    return PAGE_H - page_y_from_top

def words_at(c, y_from_top: float, items: list[tuple[float, str]], font='Helvetica', size=10):
    """Draw each (x, text) item at the same row y."""
    c.setFont(font, size)
    y = row_y(y_from_top)
    for x, text in items:
        c.drawString(x, y, text)

# ── BoA statement ─────────────────────────────────────────────────────────────

def build_boa(path: str):
    c = canvas.Canvas(path, pagesize=LETTER)

    # ── PAGE 1: Account Summary ────────────────────────────────────────────────
    # Header
    c.setFont('Helvetica-Bold', 12)
    c.drawString(36, row_y(40), 'Slo & Ready Bank — Account Summary')
    c.setFont('Helvetica', 9)
    c.drawString(36, row_y(52), 'Sample Checking Account  ••••  0023 4672 5203')

    # Period label — parser scans pages 1–2 for this
    words_at(c, 80, [
        (100, 'for'), (120, 'January'), (162, '1,'), (178, '2026'),
        (198, 'to'), (215, 'February'), (265, '28,'), (282, '2026'),
    ])

    # Summary section (amounts at x > 400 → parser reads them as expectedTotals)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(36, row_y(120), 'Account Summary')
    c.setFont('Helvetica', 10)

    summary = [
        (130, ['Deposits', 'and', 'other', 'additions'],           530, '3,600.00'),
        (150, ['ATM', 'and', 'debit', 'card', 'subtractions'],     530, '-125.45'),
        (170, ['Other', 'subtractions'],                            530, '-1,200.00'),
        (190, ['Checks'],                                           530, '-250.00'),
    ]
    for y_top, label_words, amt_x, amt in summary:
        x = 36
        c.setFont('Helvetica', 10)
        for w in label_words:
            c.drawString(x, row_y(y_top), w)
            x += c.stringWidth(w, 'Helvetica', 10) + 4
        c.setFont('Helvetica-Bold', 10)
        c.drawString(amt_x, row_y(y_top), amt)

    c.showPage()  # end page 1

    # ── PAGE 2: (blank — filler so transactions appear on page 3+) ─────────────
    c.setFont('Helvetica', 10)
    c.drawString(36, row_y(40), 'Your account details and important messages appear here.')
    c.showPage()

    # ── PAGE 3: Transactions ───────────────────────────────────────────────────
    # Page header noise (parser must skip)
    words_at(c, 30, [(36,'Page'),(56,'3'),(68,'of'),(80,'6')])
    words_at(c, 45, [(36,'KI'),(52,'KIT'),(68,'IP'),(85,'!'),(200,'Account'),(240,'#'),
                     (260,'0023'),(298,'4672'),(337,'5203')])

    # Section: Deposits
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 70, [(36,'Deposits'),(92,'and'),(112,'other'),(141,'additions')], font='Helvetica-Bold')

    # Deposit 1: one-line
    c.setFont('Helvetica', 10)
    words_at(c, 90, [
        (40, '01/15/26'),
        (91, 'DIRECT'), (124, 'DEPOSIT'), (168, 'APPFOLIO'), (215, 'PAYROLL'),
        (530, '3,600.00'),
    ])

    # Section: ATM and debit card subtractions
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 125, [(36,'ATM'),(60,'and'),(82,'debit'),(112,'card'),(143,'subtractions')], font='Helvetica-Bold')

    # ATM 1
    c.setFont('Helvetica', 10)
    words_at(c, 145, [
        (40, '01/20/26'),
        (91, 'PMNT'), (118, 'SENT'), (146, 'VENMO'), (180, '*FRIENDS'),
        (530, '-88.50'),
    ])

    # ATM 2
    words_at(c, 165, [
        (40, '02/05/26'),
        (91, 'CHECKCARD'), (148, 'TMOBILE'), (196, 'AUTO'),
        (530, '-36.95'),
    ])

    # Section: Other subtractions
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 200, [(36,'Other'),(76,'subtractions')], font='Helvetica-Bold')

    # Other 1
    c.setFont('Helvetica', 10)
    words_at(c, 220, [
        (40, '01/25/26'),
        (91, 'CITI'), (118, 'CARD'), (146, 'AUTOPAY'),
        (530, '-1,200.00'),
    ])

    # Section: Checks
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 255, [(36,'Checks')], font='Helvetica-Bold')

    # Two-column check row
    # Left: date x<85, amount 230<x<330
    # Right: date 330<x<420, amount x>525
    c.setFont('Helvetica', 10)
    words_at(c, 275, [
        (40,  '01/10/26'),   # left date  (x < 85)
        (260, '250.00'),     # left amt   (230 < x < 330)
        (360, '02/01/26'),   # right date (330 < x < 420)
        (530, '0.00'),       # right amt  (x > 525) — zero so it's a placeholder
    ])
    # Patch: the right-side check
    words_at(c, 275, [
        (530, '0.00'),       # right amt placeholder (no second check this period)
    ])
    # Actually let's only show the left check to keep it clean
    # Redraw just the one check to avoid confusion
    c.setFont('Helvetica', 10)

    # Total checks (parser must skip)
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 300, [(36,'Total'),(66,'checks'),(530,'-250.00')], font='Helvetica-Bold')

    c.showPage()
    c.save()
    print(f'  ✓ {path}')


# ── Citi statement (old format) ───────────────────────────────────────────────

def build_citi(path: str):
    c = canvas.Canvas(path, pagesize=LETTER)

    # ── PAGE 1: Account Summary ────────────────────────────────────────────────
    c.setFont('Helvetica-Bold', 12)
    c.drawString(36, row_y(40), 'Slo & Ready Credit Card — Account Summary')
    c.setFont('Helvetica', 9)
    c.drawString(36, row_y(52), 'Sample Credit Card Account  ••••  4321')

    # Period label
    words_at(c, 80, [
        (100, 'March'), (140, '1,'), (158, '2026'),
        (178, '-'), (188, 'March'), (228, '31,'), (246, '2026'),
    ])

    # Summary: Payments, Credits, Purchases (amounts at x > 400)
    c.setFont('Helvetica', 10)
    summary_rows = [
        (120, 'Payments',  530, '-1,000.00'),
        (140, 'Credits',   530, '0.00'),
        (160, 'Purchases', 530, '178.44'),
    ]
    for y_top, label, amt_x, amt in summary_rows:
        c.drawString(36, row_y(y_top), label)
        c.setFont('Helvetica-Bold', 10)
        c.drawString(amt_x, row_y(y_top), amt)
        c.setFont('Helvetica', 10)

    c.showPage()  # page 1 done

    # ── PAGE 2: blank ──────────────────────────────────────────────────────────
    c.drawString(36, row_y(40), 'Terms and conditions, important notices.')
    c.showPage()

    # ── PAGE 3: Transactions (old format — amount 340≤x≤413, sidebar x>412) ───
    # Page header noise
    words_at(c, 30, [(36,'Page'),(56,'3'),(68,'of'),(80,'5')])

    # Section: Payments and Other Credits
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 65, [
        (100,'Payments'),(144,'and'),(164,'Other'),(196,'Credits')
    ], font='Helvetica-Bold')

    # Payment row — date x<85, desc x≥155, amount 340≤x≤413, sidebar x>420 (noise)
    c.setFont('Helvetica', 10)
    words_at(c, 85, [
        (40,  '03/05'),
        (155, 'PAYMENT'), (200, 'THANK'), (234, 'YOU'),
        (370, '-1,000.00'),
        # Sidebar noise items (x > 412 — parser strips these before column detection)
        (425, 'Account'),
        (475, 'summary'),
    ])

    # Section: Standard Purchases
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 120, [(100,'Standard'),(148,'Purchases')], font='Helvetica-Bold')

    # Purchase 1: single-row
    c.setFont('Helvetica', 10)
    words_at(c, 140, [
        (40, '03/08'),
        (155, 'WHOLE'), (186, 'FOODS'), (218, 'MARKET'),
        (370, '52.37'),
        (425, 'sidebar'),
    ])

    # Purchase 2: single-row
    words_at(c, 160, [
        (40, '03/12'),
        (155, 'NETFLIX.COM'),
        (370, '17.99'),
        (425, 'sidebar'),
    ])

    # Purchase 3: virtual-card annotation edge case
    # Row a: date + merchant (no amount)
    words_at(c, 180, [
        (40, '03/15'),
        (155, 'TST*BREAD'), (205, 'SAVAGE'),
    ])
    # Row b: virtual-card annotation (parser noise filter skips this)
    words_at(c, 195, [
        (155, 'Digital'), (192, 'account'), (228, 'number'),
        (272, 'ending'), (308, 'in'), (326, '8823'),
    ])
    # Row c: amount only (orphan — parser carry-forward merges with row a)
    words_at(c, 210, [
        (370, '108.08'),
    ])

    # Total line (parser must skip)
    c.setFont('Helvetica-Bold', 10)
    words_at(c, 235, [(36,'Total'),(70,'Purchases'),(370,'178.44')], font='Helvetica-Bold')

    c.showPage()
    c.save()
    print(f'  ✓ {path}')


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    boa_out  = os.path.join(OUT_DIR, 'sample_boa_statement.pdf')
    citi_out = os.path.join(OUT_DIR, 'sample_citi_statement.pdf')
    print('Generating synthetic sample PDFs…')
    build_boa(boa_out)
    build_citi(citi_out)
    print('Done.')
    print()
    print('App Store review notes:')
    print('  1. Download sample_boa_statement.pdf')
    print('  2. Open Slo N Ready → create a Bank of America Checking account')
    print('  3. On the account screen → tap Import → Choose PDF Statement…')
    print('  4. Select the downloaded PDF → preview shows 4 transactions → Import')
    print('  5. Transactions appear in the account; Slo & Ready rules auto-categorize')
