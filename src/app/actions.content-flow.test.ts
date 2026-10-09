import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers the wizard flow actions changed in the UI revamp: the disclosure
// step no longer schedules, reject works from a draft, unschedule/revise
// exist, every status change revalidates list + dashboard, and user-facing
// errors are translated.

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
const getCampaign = vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], defaultDisclosureText: null, monthlyCostCapCents: 100_00 } as any));
vi.mock('@/lib/data', () => ({ getCampaign: () => getCampaign(), getBillingPlan: vi.fn(() => Promise.resolve(null)) }));

const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
const insert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ update, insert, select: vi.fn() })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'new-1'), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile: vi.fn(() => Promise.resolve(null)), upsertCandidateProfile: vi.fn() }));

const get = vi.fn();
const disclosureAdd = vi.fn(() => Promise.resolve());
const disclosureListFor = vi.fn(() => Promise.resolve([] as unknown[]));
const auditAppend = vi.fn(() => Promise.resolve());
vi.mock('@/lib/repos', () => ({
  contentRepo: { get }, approvalRepo: { add: vi.fn() },
  disclosureRepo: { add: disclosureAdd, listFor: disclosureListFor }, auditRepo: { append: auditAppend },
}));
const lifecycle = {
  submitForReview: vi.fn(() => Promise.resolve()),
  approve: vi.fn(() => Promise.resolve()),
  reject: vi.fn(() => Promise.resolve()),
  schedule: vi.fn(() => Promise.resolve()),
  unschedule: vi.fn(() => Promise.resolve()),
  revise: vi.fn(() => Promise.resolve()),
  markPublished: vi.fn(() => Promise.resolve()),
  assertPublishable: vi.fn(() => Promise.resolve()),
};
vi.mock('@/lib/services', () => ({
  lifecycle, disclosureEngine: { requiredFor: vi.fn(() => ({ disclosureText: 'AI disclosure', placement: 'overlay' })) },
  quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish: vi.fn(() => []) }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

const ITEM = { id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: true, body: 'b', title: 't', targetJurisdictions: [], mediaUrl: null };

function paths(): string[] {
  return revalidatePath.mock.calls.map(c => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  disclosureListFor.mockResolvedValue([]);
});

describe('confirmDisclosureAction', () => {
  it('attaches the disclosure and keeps the item approved — never schedules without a time', async () => {
    get.mockResolvedValue(ITEM);
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x', ' Paid for by the campaign. ');
    expect(r).toEqual({ ok: true });
    expect(disclosureAdd).toHaveBeenCalledWith(expect.objectContaining({ disclosureText: 'Paid for by the campaign.', placement: 'overlay' }));
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirm_disclosure', entityId: 'x' }));
    expect(lifecycle.schedule).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
    expect(paths()).toEqual(expect.arrayContaining(['/content/x', '/content', '/dashboard']));
  });

  it('is idempotent: a second confirm does not attach a second disclosure', async () => {
    get.mockResolvedValue(ITEM);
    disclosureListFor.mockResolvedValue([{ id: 'd-1' }]);
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x', 'text');
    expect(r).toEqual({ ok: true });
    expect(disclosureAdd).not.toHaveBeenCalled();
  });

  it('refuses to attach a disclosure to content that is not approved', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'draft' });
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x', 'text');
    expect(r).toEqual({ ok: false, error: 'This content must be approved before a disclosure can be attached.' });
    expect(disclosureAdd).not.toHaveBeenCalled();
  });
});

describe('decideAction (reject)', () => {
  it('rejects a draft by routing it through in_review first, with the trimmed note', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'draft' });
    const { decideAction } = await import('./actions');
    const r = await decideAction('x', 'reject', '  needs a source  ');
    expect(r).toEqual({ ok: true });
    expect(lifecycle.submitForReview).toHaveBeenCalledWith('x', 'u-1');
    expect(lifecycle.reject).toHaveBeenCalledWith('x', 'u-1', 'needs a source');
    expect(paths()).toEqual(expect.arrayContaining(['/content/x', '/content', '/dashboard']));
  });

  it('rejects an in_review item directly, with no note when the reason is blank', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'in_review' });
    const { decideAction } = await import('./actions');
    await decideAction('x', 'reject', '   ');
    expect(lifecycle.submitForReview).not.toHaveBeenCalled();
    expect(lifecycle.reject).toHaveBeenCalledWith('x', 'u-1', undefined);
  });

  it('denies reject for a role without approve permission', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'in_review' });
    const sessionMod = await import('@/lib/session');
    (sessionMod.requireSession as any).mockResolvedValueOnce({ ...session, role: 'staff' });
    const { decideAction } = await import('./actions');
    const r = await decideAction('x', 'reject', 'no');
    expect(r).toEqual({ ok: false, error: 'Permission denied.' });
    expect(lifecycle.reject).not.toHaveBeenCalled();
  });
});

describe('unscheduleAction', () => {
  it('moves a scheduled item back to approved via the lifecycle and clears scheduled_at', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'scheduled', scheduledAt: '2030-01-01T00:00:00Z' });
    const { unscheduleAction } = await import('./actions');
    const r = await unscheduleAction('x');
    expect(r).toEqual({ ok: true });
    expect(lifecycle.unschedule).toHaveBeenCalledWith('x', 'u-1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ scheduled_at: null }));
    expect(paths()).toEqual(expect.arrayContaining(['/content/x', '/content', '/dashboard']));
  });

  it('refuses when the item is not scheduled, without touching the lifecycle', async () => {
    get.mockResolvedValue(ITEM);
    const { unscheduleAction } = await import('./actions');
    const r = await unscheduleAction('x');
    expect(r).toEqual({ ok: false, error: 'This content isn’t scheduled.' });
    expect(lifecycle.unschedule).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('requires schedule permission', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'scheduled' });
    const sessionMod = await import('@/lib/session');
    (sessionMod.requireSession as any).mockResolvedValueOnce({ ...session, role: 'approver' });
    const { unscheduleAction } = await import('./actions');
    const r = await unscheduleAction('x');
    expect(r).toEqual({ ok: false, error: 'Permission denied.' });
  });

  it('refuses an item from another campaign', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'scheduled', campaignId: 'c-2' });
    const { unscheduleAction } = await import('./actions');
    const r = await unscheduleAction('x');
    expect(r).toEqual({ ok: false, error: 'Content not found.' });
    expect(lifecycle.unschedule).not.toHaveBeenCalled();
  });
});

describe('reviseAction', () => {
  it('reopens a rejected item as a draft', async () => {
    get.mockResolvedValue({ ...ITEM, status: 'rejected' });
    const { reviseAction } = await import('./actions');
    const r = await reviseAction('x');
    expect(r).toEqual({ ok: true });
    expect(lifecycle.revise).toHaveBeenCalledWith('x', 'u-1');
    expect(paths()).toEqual(expect.arrayContaining(['/content/x', '/content', '/dashboard']));
  });
});

describe('createContentAction', () => {
  function formData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it('returns a translated error instead of throwing when the campaign is missing', async () => {
    getCampaign.mockResolvedValueOnce(null);
    const { createContentAction } = await import('./actions');
    const r = await createContentAction(undefined, formData({ type: 'social_post', title: 'T', body: 'B' }));
    expect(r).toEqual({ ok: false, error: 'Campaign not found.' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('requires a body and never inserts an empty draft', async () => {
    const { createContentAction } = await import('./actions');
    const r = await createContentAction(undefined, formData({ type: 'social_post', title: 'T', body: '   ' }));
    expect(r).toEqual({ ok: false, error: 'Write or generate the content before saving.' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('uses the translated "Untitled" fallback and redirects to the new item', async () => {
    const { createContentAction } = await import('./actions');
    await createContentAction(undefined, formData({ type: 'social_post', title: '', body: 'Body' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Untitled', body: 'Body' }));
    expect(redirect).toHaveBeenCalledWith('/content/new-1');
  });
});

describe('generateDraftAction', () => {
  it('returns a translated error instead of throwing when the campaign is missing', async () => {
    getCampaign.mockResolvedValueOnce(null);
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('write', 'social_post', 'en');
    expect(r).toEqual({ ok: false, error: 'Campaign not found.' });
  });
});
