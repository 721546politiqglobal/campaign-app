import { describe, it, expect } from 'vitest';
import { UsageMeter, CapExceeded, type UsageRepo } from './usage';

// Mirrors what the reserve_usage Postgres function does: an in-flight
// reservation counts against the cap until it's finalized (released), so a
// second reserve() while the first is still open sees it and can be rejected —
// this is the behavior the old check-then-act guard()/record() pair lacked.
function fakeAtomicRepo(): UsageRepo {
  let finalizedCents = 0;
  const reservations: number[] = [];

  return {
    async monthToDateCents() {
      return finalizedCents;
    },
    async reserve(_campaignId, capCents, estimatedCents) {
      const inFlight = reservations.reduce((n, c) => n + c, 0);
      if (finalizedCents + inFlight + estimatedCents > capCents) return false;
      reservations.push(estimatedCents);
      return true;
    },
    async finalize(_campaignId, _kind, _quantity, costCents, reservedCents) {
      const idx = reservations.indexOf(reservedCents);
      if (idx !== -1) reservations.splice(idx, 1);
      finalizedCents += costCents;
    },
  };
}

describe('UsageMeter', () => {
  it('guard() throws CapExceeded when the reservation does not fit under the cap', async () => {
    const meter = new UsageMeter(fakeAtomicRepo());
    await expect(meter.guard('c-1', 100, 150)).rejects.toThrow(CapExceeded);
  });

  it('guard() succeeds when the reservation fits under the cap', async () => {
    const meter = new UsageMeter(fakeAtomicRepo());
    await expect(meter.guard('c-1', 100, 50)).resolves.toBeUndefined();
  });

  it('rejects a second reservation that would only exceed the cap once the first (still open) reservation is counted', async () => {
    const repo = fakeAtomicRepo();
    const meter = new UsageMeter(repo);

    // First request reserves $60 of a $100 cap and has not finalized yet —
    // simulates the window between guard() passing and the paid work finishing.
    await meter.guard('c-1', 100, 60);

    // A second, concurrent request for $50 would push the total to $110 if the
    // first reservation weren't counted — it must be rejected, not silently
    // allowed the way the old sum-of-recorded-only check would have allowed it.
    await expect(meter.guard('c-1', 100, 50)).rejects.toThrow(CapExceeded);
  });

  it('allows a second reservation once the first has been finalized for less than it reserved', async () => {
    const repo = fakeAtomicRepo();
    const meter = new UsageMeter(repo);

    await meter.guard('c-1', 100, 60);
    await meter.record('c-1', 'video_generation', 1, 20, 60); // actual cost came in under the estimate

    // Only $20 is now finalized and the $60 reservation is released, so a
    // second $50 request fits.
    await expect(meter.guard('c-1', 100, 50)).resolves.toBeUndefined();
  });

  it('record() defaults reservedCents to costCents when not passed explicitly', async () => {
    const repo = fakeAtomicRepo();
    const meter = new UsageMeter(repo);

    await meter.guard('c-1', 100, 40);
    await meter.record('c-1', 'voice_synthesis', 1, 40);

    expect(await repo.monthToDateCents('c-1')).toBe(40);
  });
});
