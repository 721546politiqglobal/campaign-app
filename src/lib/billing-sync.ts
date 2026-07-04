export interface UsageEventRow {
  costCents: number;
}

export function sumUsageCents(events: UsageEventRow[]): number {
  return events.reduce((sum, e) => sum + e.costCents, 0);
}

export function buildSyncKey(campaignId: string, since: string, until: string): string {
  return `${campaignId}:${since}:${until}`;
}
