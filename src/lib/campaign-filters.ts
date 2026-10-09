// Subscription statuses that count as an "active" campaign in the admin
// console (shared by the server-side list filter and the status badge).
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;
export type CampaignStatusFilter = 'all' | 'active' | 'inactive';

export function isCampaignActive(subscriptionStatus: string | null): boolean {
  return subscriptionStatus !== null && (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscriptionStatus);
}
