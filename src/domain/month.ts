export interface YearEntry {
  key:   string; // 'YYYY'
  label: string; // 'Current YTD' or 'YYYY'
  count: number;
}

const CURRENT_YEAR = new Date().getFullYear().toString();

export function buildYearList(dbYears: Array<{ year: string; count: number }>): YearEntry[] {
  return dbYears.map(({ year, count }) => ({
    key:   year,
    label: year === CURRENT_YEAR ? 'Current YTD' : year,
    count,
  }));
}

export interface MonthEntry {
  key:   string; // 'YYYY-MM'
  label: string; // 'April 2026'
  count: number; // non-dropped transaction count from DB
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  });
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Builds the full month list for the picker (newest first).
 *
 * Accepts the result of getDistinctMonths() — months with data only, newest first.
 * Fills in 0-count entries to cover the 6-month window ending at the most recent data month.
 */
export function buildMonthList(dbMonths: Array<{ month: string; count: number }>): MonthEntry[] {
  if (dbMonths.length === 0) return [];

  // dbMonths is newest-first from DB
  const dataEnd   = dbMonths[0].month;
  const dataStart = dbMonths[dbMonths.length - 1].month;

  const windowStart = addMonths(dataEnd, -5); // 6 months ending at most recent data
  const rangeStart  = dataStart < windowStart ? dataStart : windowStart;

  const countMap = new Map(dbMonths.map(m => [m.month, m.count]));

  const entries: MonthEntry[] = [];
  let cur = dataEnd;
  while (cur >= rangeStart) {
    entries.push({
      key:   cur,
      label: monthLabel(cur),
      count: countMap.get(cur) ?? 0,
    });
    cur = addMonths(cur, -1);
  }

  return entries; // newest first
}
