export interface UsageRepo {
  monthToDateCents(campaignId: string): Promise<number>;
  // Atomically checks the running total against the cap and, if it fits,
  // reserves estimatedCents against it — closing the check-then-act gap
  // between guard() and record() below.
  reserve(campaignId: string, capCents: number, estimatedCents: number): Promise<boolean>;
  // Releases the reservation for reservedCents and records the real
  // (kind, quantity, costCents) outcome. Call this exactly once per
  // successful reserve() — including with costCents 0 if the paid work never
  // actually happened, so the reservation doesn't linger.
  finalize(campaignId: string, kind: string, quantity: number, costCents: number, reservedCents: number): Promise<void>;
}

export class CapExceeded extends Error {}

export class UsageMeter {
  constructor(private repo: UsageRepo) {}

  async guard(campaignId: string, capCents: number, estimatedCents: number): Promise<void> {
    const reserved = await this.repo.reserve(campaignId, capCents, estimatedCents);
    if (!reserved) {
      throw new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.');
    }
  }

  // reservedCents defaults to costCents — every call site reserves and records
  // the same fixed cost except createAvatarAction, which can record less than
  // it reserved (partial-batch failure) and must pass the original estimate
  // explicitly so the right reservation gets released.
  async record(campaignId: string, kind: string, quantity: number, costCents: number, reservedCents: number = costCents): Promise<void> {
    await this.repo.finalize(campaignId, kind, quantity, costCents, reservedCents);
  }
}
