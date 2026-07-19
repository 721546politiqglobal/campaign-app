import { describe, it, expect, vi } from 'vitest';
import { UsageMeter, CapExceeded, type UsageRepo } from './usage';

// Mirrors what the reserve_usage / finalize_usage Postgres functions do: an
// in-flight reservation counts against the cap until it's finalized (released)
// by its id, so a second reserve() while the first is still open sees it and
// can be rejected — the behavior the old check-then-act guard()/record() lacked.
function fakeAtomicRepo(): UsageRepo {
  let finalizedCents = 0;
  let seq = 0;
  const reservations = new Map<string, number>();

  return {
    async monthToDateCents() {
      return finalizedCents;
    },
    async reserve(_campaignId, capCents, estimatedCents) {
      const inFlight = [...reservations.values()].reduce((n, c) => n + c, 0);
      if (finalizedCents + inFlight + estimatedCents > capCents) return null;
      const id = `res-${++seq}`;
      reservations.set(id, estimatedCents);
      return id;
    },
    async finalize(reservationId, _kind, _quantity, costCents) {
      reservations.delete(reservationId);
      finalizedCents += costCents;
    },
  };
}

describe('UsageMeter', () => {
  it('guard() throws CapExceeded when the reservation does not fit under the cap', async () => {
    const meter = new UsageMeter(fakeAtomicRepo());
    await expect(meter.guard('c-1', 100, 150)).rejects.toThrow(CapExceeded);
  });

  it('guard() returns a reservation id when it fits under the cap', async () => {
    const meter = new UsageMeter(fakeAtomicRepo());
    await expect(meter.guard('c-1', 100, 50)).resolves.toMatch(/^res-/);
  });

  it('rejects a second reservation that would only exceed the cap once the first (still open) reservation is counted', async () => {
    const meter = new UsageMeter(fakeAtomicRepo());
    await meter.guard('c-1', 100, 60);
    await expect(meter.guard('c-1', 100, 50)).rejects.toThrow(CapExceeded);
  });

  it('allows a second reservation once the first has been finalized for less than it reserved', async () => {
    const repo = fakeAtomicRepo();
    const meter = new UsageMeter(repo);
    const id = await meter.guard('c-1', 100, 60);
    await meter.record(id, 'video_generation', 1, 20); // actual cost under the estimate
    await expect(meter.guard('c-1', 100, 50)).resolves.toMatch(/^res-/);
  });

  it('record forwards the reservation id to finalize', async () => {
    const finalize = vi.fn(async () => {});
    const repo: UsageRepo = { monthToDateCents: async () => 0, reserve: async () => 'res-1', finalize };
    const meter = new UsageMeter(repo);
    await meter.record('res-1', 'llm_tokens', 1, 500);
    expect(finalize).toHaveBeenCalledWith('res-1', 'llm_tokens', 1, 500);
  });

  it('guard throws CapExceeded when reserve returns null', async () => {
    const repo: UsageRepo = { monthToDateCents: async () => 0, reserve: async () => null, finalize: async () => {} };
    const meter = new UsageMeter(repo);
    await expect(meter.guard('c-1', 100, 10)).rejects.toThrow(CapExceeded);
  });
});
