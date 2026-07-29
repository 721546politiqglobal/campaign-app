import { describe, it, expect } from 'vitest';
import { computeSubscriptionUpdate, isNewerEvent, planIdFromPriceId } from './billing-webhook';

describe('isNewerEvent', () => {
  it('accepts any event when none seen yet', () => { expect(isNewerEvent(1000, null)).toBe(true); });
  it('accepts a strictly newer event', () => { expect(isNewerEvent(1001, 1000)).toBe(true); });
  it('rejects an equal-or-older (stale/replayed) event', () => {
    expect(isNewerEvent(1000, 1000)).toBe(false);
    expect(isNewerEvent(999, 1000)).toBe(false);
  });
});

describe('computeSubscriptionUpdate', () => {
  it('sets a 7-day grace period when a subscription goes past_due', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const result = computeSubscriptionUpdate('past_due', now);
    expect(result).toEqual({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-08T00:00:00Z').toISOString(),
    });
  });

  it('clears the grace period when a subscription becomes active', () => {
    expect(computeSubscriptionUpdate('active')).toEqual({ subscriptionStatus: 'active', gracePeriodEndsAt: null });
  });

  it('clears the grace period immediately on cancellation — no grace period on outright cancellation', () => {
    expect(computeSubscriptionUpdate('canceled')).toEqual({ subscriptionStatus: 'canceled', gracePeriodEndsAt: null });
  });

  it('clears the grace period immediately when unpaid', () => {
    expect(computeSubscriptionUpdate('unpaid')).toEqual({ subscriptionStatus: 'unpaid', gracePeriodEndsAt: null });
  });

  it('preserves an existing grace period across repeated past_due updates instead of resetting it', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const existingGracePeriodEndsAt = new Date('2026-06-20T00:00:00Z').toISOString();
    const result = computeSubscriptionUpdate('past_due', now, existingGracePeriodEndsAt);
    expect(result).toEqual({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: existingGracePeriodEndsAt,
    });
  });

  it('still computes a fresh 7-day grace period when there is no existing one', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const result = computeSubscriptionUpdate('past_due', now, null);
    expect(result).toEqual({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-08T00:00:00Z').toISOString(),
    });
  });
});

describe('planIdFromPriceId', () => {
  const plans = [
    { id: 'starter', stripeFlatPriceId: 'price_starter' },
    { id: 'pro', stripeFlatPriceId: 'price_pro' },
  ];

  it('finds the plan id matching the given Stripe price id', () => {
    expect(planIdFromPriceId('price_pro', plans)).toBe('pro');
  });

  it('returns null when no plan matches', () => {
    expect(planIdFromPriceId('price_unknown', plans)).toBeNull();
  });

  it('returns null when priceId is undefined', () => {
    expect(planIdFromPriceId(undefined, plans)).toBeNull();
  });
});
