import { describe, it, expect } from 'vitest';
import { PLAN_DEFINITIONS } from './billing-catalog';

describe('PLAN_DEFINITIONS', () => {
  it('defines exactly starter, pro, and enterprise in ascending price order', () => {
    expect(PLAN_DEFINITIONS.map(p => p.id)).toEqual(['starter', 'pro', 'enterprise']);
    const prices = PLAN_DEFINITIONS.map(p => p.monthlyPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('has the exact full array of plan definitions', () => {
    expect(PLAN_DEFINITIONS).toEqual([
      { id: 'starter',    name: 'Starter',    monthlyPriceCents: 4_900,  seatLimit: 3,    avatarLimit: 2,  contentLimitMonthly: 15, videoLimitDaily: 1 },
      { id: 'pro',        name: 'Pro',        monthlyPriceCents: 14_900, seatLimit: 10,   avatarLimit: 5,  contentLimitMonthly: 50, videoLimitDaily: 3 },
      { id: 'enterprise', name: 'Enterprise', monthlyPriceCents: 49_900, seatLimit: null, avatarLimit: 20, contentLimitMonthly: null, videoLimitDaily: 10 },
    ]);
  });
});
