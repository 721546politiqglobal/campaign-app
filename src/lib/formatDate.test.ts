// src/lib/formatDate.test.ts
import { describe, it, expect } from 'vitest';
import { formatDate } from './formatDate';

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const hoursAgo   = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const daysAgo    = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

describe('formatDate relative', () => {
  it('returns "just now" for < 1 minute ago', () => {
    expect(formatDate(minutesAgo(0))).toBe('just now');
  });
  it('returns minutes for < 1 hour ago', () => {
    expect(formatDate(minutesAgo(5))).toBe('5 minutes ago');
  });
  it('returns singular minute', () => {
    expect(formatDate(minutesAgo(1))).toBe('1 minute ago');
  });
  it('returns hours for < 24 hours ago', () => {
    expect(formatDate(hoursAgo(3))).toBe('3 hours ago');
  });
  it('returns "yesterday" for ~1 day ago', () => {
    expect(formatDate(daysAgo(1))).toBe('yesterday');
  });
  it('returns days for 2–6 days ago', () => {
    expect(formatDate(daysAgo(4))).toBe('4 days ago');
  });
});

describe('formatDate datetime', () => {
  it('returns a human-readable datetime string', () => {
    const result = formatDate('2026-06-22T14:30:00Z', 'datetime');
    expect(result).toContain('Jun');
    expect(result).toContain('at');
  });
});

describe('formatDate date', () => {
  it('returns a short date string', () => {
    const result = formatDate('2026-06-22T00:00:00Z', 'date');
    expect(result).toContain('Jun');
    expect(result).toContain('2026');
  });
});
