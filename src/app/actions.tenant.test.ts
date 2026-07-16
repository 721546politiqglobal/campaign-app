import { describe, it, expect, vi, beforeEach } from 'vitest';

const session: any = { userId: 'u-admin', name: 'Super Admin', role: 'super_admin', campaignId: null, exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() }, throwOnError: vi.fn() }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, usageMeter: {}, billingGate: {},
  contentGenerator: {}, publisher: {}, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

describe('tenant actions reject a session with no campaign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dismissMonitoringAction fails for a super_admin (null campaignId)', async () => {
    const { dismissMonitoringAction } = await import('./actions');
    const r = await dismissMonitoringAction('mr-1');
    expect(r).toEqual({ ok: false, error: 'No campaign in session.' });
  });
});
