import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(), getBillingPlan: vi.fn() }));

// One shared chain so the `.eq('campaign_id', …)` tenant scoping is observable.
const result: { error: { message: string } | null } = { error: null };
const eqCampaign = vi.fn(() => Promise.resolve({ data: null, error: result.error }));
const eqId = vi.fn(() => ({ eq: eqCampaign }));
const update = vi.fn(() => ({ eq: eqId }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn((table: string) => { if (table !== 'monitoring_results') throw new Error(`unexpected table ${table}`); return { update }; }) },
  throwOnError: async (q: Promise<{ error: { message: string } | null }>, ctx: string) => { const r = await q; if (r.error) throw new Error(`${ctx}: ${r.error.message}`); },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn() }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {}, videoProvider: {}, voiceProvider: {},
  billingGate: {}, quotaGate: {}, photoAvatarProvider: {},
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));

beforeEach(() => { vi.clearAllMocks(); result.error = null; });

describe('dismissMonitoringAction / restoreMonitoringAction', () => {
  it("dismisses only within the caller's campaign and revalidates /monitoring", async () => {
    const { dismissMonitoringAction } = await import('./actions');
    const { revalidatePath } = await import('next/cache');
    const r = await dismissMonitoringAction('mr-1');
    expect(r).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ dismissed_at: expect.any(String) });
    expect(eqId).toHaveBeenCalledWith('id', 'mr-1');
    expect(eqCampaign).toHaveBeenCalledWith('campaign_id', 'c-1');
    expect(revalidatePath).toHaveBeenCalledWith('/monitoring');
  });

  it('restores (undo) by clearing dismissed_at with the same tenant scope', async () => {
    const { restoreMonitoringAction } = await import('./actions');
    const r = await restoreMonitoringAction('mr-1');
    expect(r).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ dismissed_at: null });
    expect(eqCampaign).toHaveBeenCalledWith('campaign_id', 'c-1');
  });

  it('reports a translated error (not the DB message) when the write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    result.error = { message: 'permission denied for table monitoring_results' };
    const { dismissMonitoringAction } = await import('./actions');
    const r = await dismissMonitoringAction('mr-1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toMatch(/permission denied for table/);
      expect(r.error).toMatch(/try again/i);
    }
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('refuses when the session has no campaign', async () => {
    const { requireSession } = await import('@/lib/session');
    vi.mocked(requireSession).mockResolvedValueOnce({ ...session, campaignId: null as unknown as string });
    const { dismissMonitoringAction } = await import('./actions');
    const r = await dismissMonitoringAction('mr-1');
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
