import { describe, it, expect } from 'vitest';
import { zonedNaiveToUtc } from './timezone';

describe('zonedNaiveToUtc', () => {
  it('interprets a summer PT wall-clock time as PDT (UTC-7)', () => {
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'America/Los_Angeles').toISOString())
      .toBe('2026-07-20T17:00:00.000Z');
  });

  it('interprets a winter PT wall-clock time as PST (UTC-8)', () => {
    expect(zonedNaiveToUtc('2026-01-20T10:00', 'America/Los_Angeles').toISOString())
      .toBe('2026-01-20T18:00:00.000Z');
  });

  it('is identity for UTC', () => {
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'UTC').toISOString())
      .toBe('2026-07-20T10:00:00.000Z');
  });

  it('handles a positive-offset zone (Europe/Berlin, CEST UTC+2)', () => {
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'Europe/Berlin').toISOString())
      .toBe('2026-07-20T08:00:00.000Z');
  });
});
