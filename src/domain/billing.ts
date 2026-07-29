export interface CampaignBillingInfo {
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
}

export interface BillingRepo {
  getBillingInfo(campaignId: string): Promise<CampaignBillingInfo | null>;
}

export class BillingBlocked extends Error {}

// Shared so the billing page banner can message every status the gate blocks
// (audit finding BILL-12), not just canceled/unpaid.
export const INACTIVE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

export class BillingGate {
  constructor(private repo: BillingRepo) {}

  async check(campaignId: string, now: Date = new Date()): Promise<void> {
    const info = await this.repo.getBillingInfo(campaignId);
    // No billing record at all (no such campaign row, or a super_admin session
    // with no campaign) — nothing to enforce here; the caller's own
    // campaign/permission checks handle it.
    if (!info) return;

    // A real campaign row that has never been subscribed. This MUST block:
    // plan limits are read as `plan?.contentLimitMonthly ?? null` and the quota
    // gate treats null as "unlimited", so letting a no-plan campaign through
    // would hand it unlimited free access to every paid feature.
    if (!info.subscriptionStatus) {
      throw new BillingBlocked(
        'This campaign must subscribe to a plan before using this feature. Visit /pricing to subscribe.',
      );
    }

    if (INACTIVE_STATUSES.has(info.subscriptionStatus)) {
      throw new BillingBlocked(
        'This campaign\'s subscription is inactive. Contact your platform admin to restore access.',
      );
    }

    if (info.subscriptionStatus === 'past_due' && info.gracePeriodEndsAt) {
      if (now > new Date(info.gracePeriodEndsAt)) {
        throw new BillingBlocked(
          'This campaign\'s payment is past due and the grace period has ended. Contact your platform admin to restore access.',
        );
      }
    }
  }
}
