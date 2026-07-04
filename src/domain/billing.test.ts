import { describe, it, expect } from 'vitest';
import { BillingGate, BillingBlocked, type BillingRepo, type CampaignBillingInfo } from './billing';

function fakeRepo(info: CampaignBillingInfo | null): BillingRepo {
  return { async getBillingInfo() { return info; } };
}

describe('BillingGate.check', () => {
  it('allows a campaign with no plan assigned yet', async () => {
    const gate = new BillingGate(fakeRepo(null));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows an active subscription', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'active', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows trialing subscriptions', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'trialing', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows past_due within the grace period', async () => {
    const gate = new BillingGate(fakeRepo({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-10T00:00:00Z').toISOString(),
    }));
    await expect(gate.check('camp-1', new Date('2026-07-05T00:00:00Z'))).resolves.toBeUndefined();
  });

  it('blocks past_due once the grace period has ended', async () => {
    const gate = new BillingGate(fakeRepo({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-01T00:00:00Z').toISOString(),
    }));
    await expect(gate.check('camp-1', new Date('2026-07-05T00:00:00Z'))).rejects.toThrow(BillingBlocked);
  });

  it('blocks a canceled subscription immediately, regardless of grace period', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'canceled', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });

  it('blocks an unpaid subscription immediately', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'unpaid', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });

  it('blocks an incomplete_expired subscription immediately', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'incomplete_expired', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });

  it('blocks a paused subscription immediately', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'paused', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });

  it('allows an incomplete subscription (pre-payment grace window right after plan assignment)', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'incomplete', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });
});
