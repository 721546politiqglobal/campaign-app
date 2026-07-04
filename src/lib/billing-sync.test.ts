import { describe, it, expect } from 'vitest';
import { sumUsageCents, buildSyncKey } from './billing-sync';

describe('sumUsageCents', () => {
  it('returns 0 for no events', () => {
    expect(sumUsageCents([])).toBe(0);
  });

  it('sums cost across events', () => {
    expect(sumUsageCents([{ costCents: 500 }, { costCents: 300 }])).toBe(800);
  });
});

describe('buildSyncKey', () => {
  it('builds a deterministic key from campaign id and range boundaries', () => {
    expect(buildSyncKey('camp-1', '2026-07-01T00:00:00Z', '2026-07-01T00:30:00Z'))
      .toBe('camp-1:2026-07-01T00:00:00Z:2026-07-01T00:30:00Z');
  });
});
