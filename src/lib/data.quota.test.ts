import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

describe('getContentUsageThisPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the count for the campaign\'s billing-period-anchored period_start', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('feature_usage_counters');
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            if (col === 'campaign_id') expect(val).toBe('camp-1');
            return {
              eq: (col2: string, val2: string) => {
                if (col2 === 'feature') expect(val2).toBe('content');
                return {
                  eq: (col3: string, val3: string) => {
                    expect(col3).toBe('period_start');
                    expect(val3).toBe('2026-06-20T00:00:00.000Z');
                    return { maybeSingle: () => Promise.resolve({ data: { count: 7 }, error: null }) };
                  },
                };
              },
            };
          },
        }),
      };
    });
    const { getContentUsageThisPeriod } = await import('./data');
    expect(await getContentUsageThisPeriod('camp-1', '2026-07-20T00:00:00Z')).toBe(7);
  });

  it('returns 0 when no counter row exists yet', async () => {
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
    }));
    const { getContentUsageThisPeriod } = await import('./data');
    expect(await getContentUsageThisPeriod('camp-1', null)).toBe(0);
  });
});

describe('getAvatarCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the exact avatar row count for the campaign', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('avatars');
      return { select: () => ({ eq: () => Promise.resolve({ count: 4, error: null }) }) };
    });
    const { getAvatarCount } = await import('./data');
    expect(await getAvatarCount('camp-1')).toBe(4);
  });
});
