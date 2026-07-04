export type StripeSubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
  | 'incomplete' | 'incomplete_expired' | 'paused';

export interface BillingUpdate {
  subscriptionStatus: string;
  gracePeriodEndsAt: string | null;
}

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function computeSubscriptionUpdate(
  status: StripeSubscriptionStatus,
  now: Date = new Date(),
  existingGracePeriodEndsAt: string | null = null,
): BillingUpdate {
  if (status === 'past_due') {
    if (existingGracePeriodEndsAt) {
      return { subscriptionStatus: 'past_due', gracePeriodEndsAt: existingGracePeriodEndsAt };
    }
    return {
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date(now.getTime() + GRACE_PERIOD_MS).toISOString(),
    };
  }
  return { subscriptionStatus: status, gracePeriodEndsAt: null };
}
