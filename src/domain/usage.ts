export interface UsageRepo {
  monthToDateCents(campaignId: string): Promise<number>;
  // Atomically checks the running total against the cap and, if it fits,
  // reserves estimatedCents — returning the reservation id (null if it would
  // exceed the cap). Closes the check-then-act gap between guard() and record().
  reserve(campaignId: string, capCents: number, estimatedCents: number): Promise<string | null>;
  // Releases the reservation by id and records the real (kind, quantity,
  // costCents) outcome in one atomic step. Call exactly once per successful
  // reserve() — including with costCents 0 if the paid work never happened.
  finalize(reservationId: string, kind: string, quantity: number, costCents: number): Promise<void>;
}

export class CapExceeded extends Error {}

export class UsageMeter {
  constructor(private repo: UsageRepo) {}

  async guard(campaignId: string, capCents: number, estimatedCents: number): Promise<string> {
    const reservationId = await this.repo.reserve(campaignId, capCents, estimatedCents);
    if (!reservationId) {
      throw new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.');
    }
    return reservationId;
  }

  async record(reservationId: string, kind: string, quantity: number, costCents: number): Promise<void> {
    await this.repo.finalize(reservationId, kind, quantity, costCents);
  }
}
