import { describe, it, expect } from 'vitest';
import { PLAN_DEFINITIONS, METER_EVENT_NAME } from './billing-catalog';

describe('PLAN_DEFINITIONS', () => {
  it('defines exactly starter, pro, and enterprise in ascending price order', () => {
    expect(PLAN_DEFINITIONS.map(p => p.id)).toEqual(['starter', 'pro', 'enterprise']);
    const prices = PLAN_DEFINITIONS.map(p => p.monthlyPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('gives every plan a positive included usage allowance and an overage multiplier above 1', () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(plan.includedUsageCents).toBeGreaterThan(0);
      expect(plan.overageMultiplier).toBeGreaterThan(1);
    }
  });

  it('has exact values for the starter plan', () => {
    const starter = PLAN_DEFINITIONS.find(p => p.id === 'starter');
    expect(starter).toEqual({
      id: 'starter',
      name: 'Starter',
      monthlyPriceCents: 4_900,
      seatLimit: 3,
      includedUsageCents: 2_500,
      overageMultiplier: 1.3,
    });
  });

  it('has exact values for the pro plan', () => {
    const pro = PLAN_DEFINITIONS.find(p => p.id === 'pro');
    expect(pro).toEqual({
      id: 'pro',
      name: 'Pro',
      monthlyPriceCents: 14_900,
      seatLimit: 10,
      includedUsageCents: 10_000,
      overageMultiplier: 1.3,
    });
  });

  it('has exact values for the enterprise plan', () => {
    const enterprise = PLAN_DEFINITIONS.find(p => p.id === 'enterprise');
    expect(enterprise).toEqual({
      id: 'enterprise',
      name: 'Enterprise',
      monthlyPriceCents: 49_900,
      seatLimit: null,
      includedUsageCents: 40_000,
      overageMultiplier: 1.2,
    });
  });

  it('has the exact full array of plan definitions', () => {
    expect(PLAN_DEFINITIONS).toEqual([
      { id: 'starter',    name: 'Starter',    monthlyPriceCents: 4_900,  seatLimit: 3,    includedUsageCents: 2_500,  overageMultiplier: 1.3 },
      { id: 'pro',        name: 'Pro',        monthlyPriceCents: 14_900, seatLimit: 10,   includedUsageCents: 10_000, overageMultiplier: 1.3 },
      { id: 'enterprise', name: 'Enterprise', monthlyPriceCents: 49_900, seatLimit: null, includedUsageCents: 40_000, overageMultiplier: 1.2 },
    ]);
  });
});

describe('METER_EVENT_NAME', () => {
  it('is a non-empty string', () => {
    expect(METER_EVENT_NAME.length).toBeGreaterThan(0);
  });

  it('has the exact expected value', () => {
    expect(METER_EVENT_NAME).toEqual('platform_usage_cents');
  });
});
