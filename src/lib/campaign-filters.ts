export type CampaignStatusFilter = 'all' | 'active' | 'inactive';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export function isCampaignActive(subscriptionStatus: string | null): boolean {
  return subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
}

export function filterCampaigns<T extends { subscriptionStatus: string | null; tags: string[] }>(
  campaigns: T[],
  statusFilter: CampaignStatusFilter,
  tagFilter: string[],
): T[] {
  return campaigns.filter(c => {
    const active = isCampaignActive(c.subscriptionStatus);
    if (statusFilter === 'active' && !active) return false;
    if (statusFilter === 'inactive' && active) return false;
    if (tagFilter.length > 0 && !tagFilter.some(t => c.tags.includes(t))) return false;
    return true;
  });
}
