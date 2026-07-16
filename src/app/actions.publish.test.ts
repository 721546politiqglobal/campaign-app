import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'new-1') }));

const get = vi.fn();
vi.mock('@/lib/repos', () => ({
  contentRepo: { get }, approvalRepo: { add: vi.fn() },
  disclosureRepo: { add: vi.fn(), listFor: vi.fn(() => Promise.resolve([])) }, auditRepo: { append: vi.fn() },
}));
const publish = vi.fn();
const lifecycle = { markPublished: vi.fn(() => Promise.resolve()) };
vi.mock('@/lib/services', () => ({
  lifecycle, disclosureEngine: { requiredFor: vi.fn(() => []) },
  usageMeter: { guard: vi.fn(), record: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

const ITEM = { id: 'x', campaignId: 'c-1', status: 'scheduled', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [], mediaUrl: null };

describe('publishAction does not mark published when everything fails', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns an error and never marks published when all platforms fail', async () => {
    get.mockResolvedValue(ITEM);
    publish.mockResolvedValue([{ platform: 'x', status: 'failed', error: 'account unlinked' }]);
    const { publishAction } = await import('./actions');
    const r = await publishAction('x', ['x'] as any);
    expect(r.ok).toBe(false);
    expect(lifecycle.markPublished).not.toHaveBeenCalled();
  });

  it('marks published when at least one platform succeeds', async () => {
    get.mockResolvedValue(ITEM);
    publish.mockResolvedValue([{ platform: 'x', status: 'scheduled' }]);
    const { publishAction } = await import('./actions');
    const r = await publishAction('x', ['x'] as any);
    expect(r.ok).toBe(true);
    expect(lifecycle.markPublished).toHaveBeenCalledWith('x', 'u-1');
  });
});
