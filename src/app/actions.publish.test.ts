import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
const dbUpdate = vi.fn();
const dbEq = vi.fn(() => Promise.resolve({ error: null }));
dbUpdate.mockImplementation(() => ({ eq: dbEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: dbUpdate })) } }));
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
  quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() }, billingGate: { check: vi.fn() },
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

  // Analytics sync only ever looks at ayrshare_post_ids — an immediate
  // publish that never wrote them there would be invisible to analytics
  // forever, exactly like the cron path already guarded against.
  it('persists ayrshare_post_ids so analytics sync can find this publish later', async () => {
    get.mockResolvedValue(ITEM);
    publish.mockResolvedValue([{ platform: 'x', status: 'scheduled', postId: 'post-123' }]);
    const { publishAction } = await import('./actions');
    await publishAction('x', ['x'] as any);
    expect(dbUpdate).toHaveBeenCalledWith({ ayrshare_post_ids: { x: 'post-123' } });
  });

  it('does not write ayrshare_post_ids when no platform returned a postId', async () => {
    get.mockResolvedValue(ITEM);
    publish.mockResolvedValue([{ platform: 'x', status: 'scheduled' }]);
    const { publishAction } = await import('./actions');
    await publishAction('x', ['x'] as any);
    expect(dbUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ ayrshare_post_ids: expect.anything() }));
  });
});
