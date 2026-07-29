import { describe, it, expect } from 'vitest';
import { QuotaGate, QuotaExceeded, QuotaRepo, videoPeriodStart, contentPeriodStart } from './quota';

function fakeRepo(overrides: Partial<QuotaRepo> = {}): QuotaRepo {
  return {
    async incrementFeatureUsage() { return true; },
    async decrementFeatureUsage() {},
    async countAvatars() { return 0; },
    ...overrides,
  };
}

describe('QuotaGate.checkAndIncrement', () => {
  it('resolves when the repo reports the increment succeeded', async () => {
    const gate = new QuotaGate(fakeRepo({ incrementFeatureUsage: async () => true }));
    await expect(gate.checkAndIncrement('camp-1', 'content', new Date('2026-07-01'), 15)).resolves.toBeUndefined();
  });

  it('throws QuotaExceeded with feature "content" when the repo reports the limit was hit', async () => {
    const gate = new QuotaGate(fakeRepo({ incrementFeatureUsage: async () => false }));
    await expect(gate.checkAndIncrement('camp-1', 'content', new Date('2026-07-01'), 15))
      .rejects.toMatchObject({ feature: 'content' });
  });

  it('throws QuotaExceeded with feature "video" when the repo reports the limit was hit', async () => {
    const gate = new QuotaGate(fakeRepo({ incrementFeatureUsage: async () => false }));
    await expect(gate.checkAndIncrement('camp-1', 'video', new Date('2026-07-27'), 1))
      .rejects.toBeInstanceOf(QuotaExceeded);
  });

  it('passes the exact campaignId, feature, periodStart, and limit through to the repo', async () => {
    let captured: unknown[] = [];
    const gate = new QuotaGate(fakeRepo({
      incrementFeatureUsage: async (...args) => { captured = args; return true; },
    }));
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    await gate.checkAndIncrement('camp-9', 'content', periodStart, 50);
    expect(captured).toEqual(['camp-9', 'content', periodStart, 50]);
  });
});

describe('QuotaGate.release', () => {
  it('decrements the same campaign/feature/period the increment used', async () => {
    let captured: unknown[] = [];
    const gate = new QuotaGate(fakeRepo({
      decrementFeatureUsage: async (...args) => { captured = args; },
    }));
    const periodStart = new Date('2026-07-27T00:00:00.000Z');
    await gate.release('camp-9', 'video', periodStart);
    expect(captured).toEqual(['camp-9', 'video', periodStart]);
  });

  it('resolves (never throws) so a release can be attempted on any failure path', async () => {
    const gate = new QuotaGate(fakeRepo());
    await expect(gate.release('camp-1', 'content', new Date('2026-07-01'))).resolves.toBeUndefined();
  });

  it('returns a slot so a subsequent checkAndIncrement can use it again', async () => {
    // Real counter semantics: increment to the limit, release, increment again.
    let count = 0;
    const limitOf = 1;
    const gate = new QuotaGate(fakeRepo({
      incrementFeatureUsage: async () => { if (count >= limitOf) return false; count += 1; return true; },
      decrementFeatureUsage: async () => { count = Math.max(count - 1, 0); },
    }));
    const periodStart = new Date('2026-07-27T00:00:00.000Z');
    await gate.checkAndIncrement('camp-1', 'video', periodStart, limitOf);
    await expect(gate.checkAndIncrement('camp-1', 'video', periodStart, limitOf)).rejects.toBeInstanceOf(QuotaExceeded);
    await gate.release('camp-1', 'video', periodStart);
    await expect(gate.checkAndIncrement('camp-1', 'video', periodStart, limitOf)).resolves.toBeUndefined();
  });
});

describe('QuotaGate.checkAvatarCap', () => {
  it('resolves when limit is null (unlimited)', async () => {
    const gate = new QuotaGate(fakeRepo({ countAvatars: async () => 999 }));
    await expect(gate.checkAvatarCap('camp-1', null)).resolves.toBeUndefined();
  });

  it('resolves when the current count is under the limit', async () => {
    const gate = new QuotaGate(fakeRepo({ countAvatars: async () => 1 }));
    await expect(gate.checkAvatarCap('camp-1', 2)).resolves.toBeUndefined();
  });

  it('throws QuotaExceeded with feature "avatar" when the count has reached the limit', async () => {
    const gate = new QuotaGate(fakeRepo({ countAvatars: async () => 2 }));
    await expect(gate.checkAvatarCap('camp-1', 2)).rejects.toMatchObject({ feature: 'avatar' });
  });
});

describe('videoPeriodStart', () => {
  it('returns the start of the UTC day for the given time', () => {
    const now = new Date('2026-07-27T15:42:00.000Z');
    expect(videoPeriodStart(now).toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
});

describe('contentPeriodStart', () => {
  it('delegates to the billing-period-anchored window', () => {
    const result = contentPeriodStart('2026-07-20T00:00:00Z', new Date('2026-07-25T00:00:00Z'));
    expect(result.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });

  it('falls back to the current UTC calendar month with no subscription yet', () => {
    const result = contentPeriodStart(null, new Date('2026-07-25T12:00:00Z'));
    expect(result.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
