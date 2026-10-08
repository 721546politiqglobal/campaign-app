import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));

const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ update })) },
  throwOnError: async (q: any) => (await q).data,
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'new-1') }));

const get = vi.fn();
vi.mock('@/lib/repos', () => ({
  contentRepo: { get }, approvalRepo: { add: vi.fn() },
  disclosureRepo: { add: vi.fn(), listFor: vi.fn(() => Promise.resolve([])) }, auditRepo: { append: vi.fn() },
}));
const getCampaignSocialProfile = vi.fn(async () => ({
  profileKey: 'pk-1' as string | null, syncedAt: null,
  accounts: ['x', 'instagram', 'tiktok', 'facebook'].map(platform => ({ platform, name: platform, handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false })),
}));
vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile }));
const schedule = vi.fn(() => Promise.resolve());
vi.mock('@/lib/services', () => ({
  lifecycle: { schedule },
  disclosureEngine: { requiredFor: vi.fn(() => null) },
  quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish: vi.fn() }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

const ITEM = {
  id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: false,
  body: 'b', title: 't', targetJurisdictions: [], mediaUrl: null,
};
// A week out: the fixture pins 12:00 on that date, so "an hour from now" was
// in the past whenever the suite ran after midday.
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const SCHEDULED_AT = `${FUTURE.getFullYear()}-${String(FUTURE.getMonth() + 1).padStart(2, '0')}-${String(FUTURE.getDate()).padStart(2, '0')}T12:00`;

describe('scheduleWithTimeAction blocks media-required platforms with no media', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects instagram/tiktok up front for content with no media, without touching the schedule gate', async () => {
    get.mockResolvedValue({ ...ITEM, mediaUrl: null });
    const { scheduleWithTimeAction } = await import('./actions');
    const r = await scheduleWithTimeAction('x', ['instagram', 'facebook'] as any, SCHEDULED_AT, 'America/New_York');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining('instagram') });
    expect(schedule).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('allows instagram/tiktok when the content has media attached', async () => {
    get.mockResolvedValue({ ...ITEM, mediaUrl: 'https://media.test/v.mp4' });
    const { scheduleWithTimeAction } = await import('./actions');
    const r = await scheduleWithTimeAction('x', ['instagram'] as any, SCHEDULED_AT, 'America/New_York');
    expect(r.ok).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it('refuses to schedule to a network the campaign has not connected', async () => {
    get.mockResolvedValue({ ...ITEM, mediaUrl: 'https://media.test/v.mp4' });
    getCampaignSocialProfile.mockResolvedValueOnce({ profileKey: 'pk-1', syncedAt: null, accounts: [] });
    const { scheduleWithTimeAction } = await import('./actions');
    const r = await scheduleWithTimeAction('x', ['instagram'] as any, SCHEDULED_AT, 'America/New_York');
    expect(r).toEqual({ ok: false, error: 'Connect Instagram on the Channels page first.' });
    expect(schedule).not.toHaveBeenCalled();
  });
});
