// Supabase caps an unbounded select at 1,000 rows, so a count that lands
// exactly on the cap is "at least this many", not an exact figure. Pages that
// count rows from such a query show it as "1,000+" (common.countCapped).
export const SUPABASE_ROW_CAP = 1000;

export function isAtRowCap(count: number): boolean {
  return count >= SUPABASE_ROW_CAP;
}

/**
 * Display label for a row count that may have hit the cap.
 *   rowCountLabel(n, format.number, c => tc('countCapped', { count: c }))
 */
export function rowCountLabel(
  count: number,
  formatNumber: (n: number) => string,
  capped: (formattedCap: string) => string,
): string {
  return isAtRowCap(count) ? capped(formatNumber(SUPABASE_ROW_CAP)) : formatNumber(count);
}
