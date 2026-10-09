import { describe, it, expect } from 'vitest';
import { SUPABASE_ROW_CAP, isAtRowCap, rowCountLabel } from './row-cap';

const fmt = (n: number) => n.toLocaleString('en-US');
const capped = (c: string) => `${c}+`;

describe('row cap', () => {
  it('detects the cap', () => {
    expect(isAtRowCap(SUPABASE_ROW_CAP - 1)).toBe(false);
    expect(isAtRowCap(SUPABASE_ROW_CAP)).toBe(true);
    expect(isAtRowCap(SUPABASE_ROW_CAP + 5)).toBe(true);
  });

  it('formats exact counts below the cap', () => {
    expect(rowCountLabel(999, fmt, capped)).toBe('999');
    expect(rowCountLabel(0, fmt, capped)).toBe('0');
  });

  it('labels capped counts with the cap, not the raw count', () => {
    expect(rowCountLabel(1000, fmt, capped)).toBe('1,000+');
    expect(rowCountLabel(1500, fmt, capped)).toBe('1,000+');
  });
});
