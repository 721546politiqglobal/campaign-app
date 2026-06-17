export interface UsageRepo {
  monthToDateCents(campaignId: string): Promise<number>;
  record(campaignId: string, kind: string, quantity: number, costCents: number): Promise<void>;
}

export class CapExceeded extends Error {}

export class UsageMeter {
  constructor(private repo: UsageRepo) {}

  async guard(campaignId: string, capCents: number, estimatedCents: number): Promise<void> {
    const used = await this.repo.monthToDateCents(campaignId);
    if (used + estimatedCents > capCents) {
      throw new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.');
    }
  }

  async record(campaignId: string, kind: string, quantity: number, costCents: number): Promise<void> {
    await this.repo.record(campaignId, kind, quantity, costCents);
  }
}
