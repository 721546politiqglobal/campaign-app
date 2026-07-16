import { describe, it, expect } from 'vitest';
import { billingPeriodStart } from './billing-period';

describe('billingPeriodStart', () => {
  it('is one month before current_period_end when subscribed', () => {
    expect(billingPeriodStart('2026-07-20T00:00:00Z').toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });
  it('falls back to the UTC first-of-month when there is no subscription', () => {
    const now = new Date('2026-07-15T18:30:00Z');
    expect(billingPeriodStart(null, now).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
