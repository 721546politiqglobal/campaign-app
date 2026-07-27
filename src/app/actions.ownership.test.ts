import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));

const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update, select: vi.fn(), insert: vi.fn() })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'new-1') }));

const get = vi.fn();
vi.mock('@/lib/repos', () => ({
  contentRepo: { get }, approvalRepo: { add: vi.fn() },
  disclosureRepo: { add: vi.fn(), listFor: vi.fn(() => []) }, auditRepo: { append: vi.fn() },
}));
const lifecycle = { submitForReview: vi.fn(), approve: vi.fn(), reject: vi.fn(), schedule: vi.fn(), markPublished: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle, disclosureEngine: { requiredFor: vi.fn(() => []) },
  quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish: vi.fn(() => []) }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

const FOREIGN = { id: 'x', campaignId: 'c-2', status: 'draft', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [] };

describe('content actions enforce campaign ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('saveBodyAction refuses an item from another campaign', async () => {
    get.mockResolvedValue(FOREIGN);
    const { saveBodyAction } = await import('./actions');
    const r = await saveBodyAction('x', 'hacked');
    expect(r).toEqual({ ok: false, error: 'Content not found.' });
    expect(update).not.toHaveBeenCalled();
  });

  it('submitAction refuses an item from another campaign', async () => {
    get.mockResolvedValue(FOREIGN);
    const { submitAction } = await import('./actions');
    const r = await submitAction('x');
    expect(r).toEqual({ ok: false, error: 'Content not found.' });
    expect(lifecycle.submitForReview).not.toHaveBeenCalled();
  });

  it('decideAction denies approve for a role without permission', async () => {
    get.mockResolvedValue({ ...FOREIGN, campaignId: 'c-1' });
    const sessionMod = await import('@/lib/session');
    (sessionMod.requireSession as any).mockResolvedValueOnce({ ...session, role: 'staff' });
    const { decideAction } = await import('./actions');
    const r = await decideAction('x', 'approve', '');
    expect(r).toEqual({ ok: false, error: 'Permission denied.' });
    expect(lifecycle.approve).not.toHaveBeenCalled();
  });
});
