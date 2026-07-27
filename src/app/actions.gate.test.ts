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
const lifecycle = {
  submitForReview: vi.fn(() => Promise.resolve()),
  approve: vi.fn(() => Promise.resolve()),
  reject: vi.fn(() => Promise.resolve()),
  schedule: vi.fn(() => Promise.resolve()),
  markPublished: vi.fn(() => Promise.resolve()),
};
vi.mock('@/lib/services', () => ({
  lifecycle, disclosureEngine: { requiredFor: vi.fn(() => []) },
  quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish: vi.fn(() => []) }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

describe('scheduling hard gate cannot be bypassed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('confirmDisclosureAction routes through lifecycle.schedule (never a raw scheduled write)', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: true, body: 'b', title: 't', targetJurisdictions: ['US-CA'] });
    const { confirmDisclosureAction } = await import('./actions');
    await confirmDisclosureAction('x');
    expect(lifecycle.schedule).toHaveBeenCalledWith('x', 'u-1');
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
  });

  it('confirmDisclosureAction surfaces the gate error when approval is missing', async () => {
    const { GateError } = await import('@/domain/content-lifecycle');
    lifecycle.schedule.mockRejectedValueOnce(new GateError('Can’t schedule: no human approval on record.'));
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: true, body: 'b', title: 't', targetJurisdictions: ['US-CA'] });
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x');
    expect(r.ok).toBe(false);
  });

  it('confirmDisclosureAction denies a role without schedule permission', async () => {
    const sessionMod = await import('@/lib/session');
    (sessionMod.requireSession as any).mockResolvedValueOnce({ ...session, role: 'staff' });
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x');
    expect(r).toEqual({ ok: false, error: 'Permission denied.' });
    expect(lifecycle.schedule).not.toHaveBeenCalled();
  });

  it('approveTextAction never writes status=scheduled directly', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'in_review', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [] });
    const { approveTextAction } = await import('./actions');
    await approveTextAction('x');
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
  });

  it('confirmVideoAction never writes status=scheduled directly', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'in_review', type: 'reel', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [] });
    const { confirmVideoAction } = await import('./actions');
    await confirmVideoAction('x', 'https://media.test/v.mp4');
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
  });
});
