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

// Stripe redelivers subscription events without ordering guarantees; a stale
// `active` arriving after a `past_due` must not overwrite the newer status
// (BILL-7). Compare the incoming event's `created` (unix seconds) against the
// newest one already applied for this campaign.
export function isNewerEvent(eventCreatedSec: number, lastSeenSec: number | null): boolean {
  if (lastSeenSec == null) return true;
  return eventCreatedSec > lastSeenSec;
}

// Matches retired price ids too: a super_admin editing a plan's price archives the
// old Stripe price and points the row at a new one, but a Checkout session opened
// before the edit still completes against the old price. Without the retired-id
// fallback that webhook finds no plan, 500s, and the paying campaign never gets a
// plan_id — BillingGate then locks them out indefinitely.
export function planIdFromPriceId(
  priceId: string | undefined,
  plans: { id: string; stripeFlatPriceId: string; retiredStripePriceIds?: string[] }[],
): string | null {
  if (!priceId) return null;
  return plans.find(p => p.stripeFlatPriceId === priceId || (p.retiredStripePriceIds ?? []).includes(priceId))?.id ?? null;
}
