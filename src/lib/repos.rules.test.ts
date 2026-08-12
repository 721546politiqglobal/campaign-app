import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

describe('rulesRepo.get', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a DisclosureRule when a rule exists for the jurisdiction', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('disclosure_rules');
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: {
                jurisdiction: 'US-CA',
                requires_ai_label: true,
                required_text: 'CA disclosure text',
                placement: 'overlay',
                blackout_days_before_election: null,
                needs_legal_review: false,
              },
              error: null,
            }),
          }),
        }),
      };
    });
    const { rulesRepo } = await import('./repos');
    const rule = await rulesRepo.get('US-CA');
    expect(rule).toEqual({
      jurisdiction: 'US-CA',
      requiresAiLabel: true,
      requiredText: 'CA disclosure text',
      placement: 'overlay',
      blackoutDaysBeforeElection: null,
      needsLegalReview: false,
    });
  });

  it('returns null when no rule exists for the jurisdiction', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('disclosure_rules');
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: null,
              error: null,
            }),
          }),
        }),
      };
    });
    const { rulesRepo } = await import('./repos');
    const rule = await rulesRepo.get('US-NOWHERE');
    expect(rule).toBeNull();
  });

  it('throws an error if the database query fails', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('disclosure_rules');
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: null,
              error: { message: 'Database connection failed', code: 'PGRST000' },
            }),
          }),
        }),
      };
    });
    const { rulesRepo } = await import('./repos');
    await expect(rulesRepo.get('US-CA')).rejects.toThrow();
  });
});
