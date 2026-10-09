import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null, locale: 'en' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'av-new'), inviteCode: vi.fn() }));

const getCandidateProfile = vi.fn();
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

const insertAvatar = vi.fn(() => Promise.resolve());
vi.mock('@/lib/avatars', () => ({ insertAvatar }));

// avatars.select('id').eq('campaign_id').eq(<col>).limit(1) — the second eq's
// column decides which lookup it is (heygen_group_id vs name).
let byGroup: { id: string }[] = [];
let byName: { id: string }[] = [];
const avatarUpdateEq = vi.fn(async (..._a: unknown[]) => ({ error: null }));
const avatarUpdate = vi.fn((_patch: unknown) => ({ eq: avatarUpdateEq }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table !== 'avatars') throw new Error('unexpected table ' + table);
      return {
        select: () => ({
          eq: () => ({
            eq: (col: string) => ({
              limit: async () => ({ data: col === 'heygen_group_id' ? byGroup : byName, error: null }),
            }),
          }),
        }),
        update: avatarUpdate,
      };
    }),
  },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1');
  f.set('heygen_base_avatar_id', 'group-123');
  f.set('consent', 'on');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('assignAvatarAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    byGroup = []; byName = [];
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
  });

  it('inserts a default avatar and activates it when none exists', async () => {
    const { assignAvatarAction } = await import('./actions');
    const r = await assignAvatarAction(fd());
    expect(r).toEqual({ ok: true });
    expect(insertAvatar).toHaveBeenCalledWith(expect.objectContaining({ id: 'av-new', campaignId: 'c-1', heygenGroupId: 'group-123', status: 'ready' }));
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { activeAvatarId: 'av-new', heygenBaseAvatarId: 'group-123', heygenAvatarId: null });
  });

  it('re-uses the row already linked to this HeyGen group instead of inserting another (quota)', async () => {
    byGroup = [{ id: 'av-existing' }];
    const { assignAvatarAction } = await import('./actions');
    const r = await assignAvatarAction(fd());
    expect(r).toEqual({ ok: true });
    expect(insertAvatar).not.toHaveBeenCalled();
    expect(avatarUpdate).toHaveBeenCalledWith(expect.objectContaining({ heygen_group_id: 'group-123', status: 'ready' }));
    expect(avatarUpdateEq).toHaveBeenCalledWith('id', 'av-existing');
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({ activeAvatarId: 'av-existing' }));
  });

  it('re-points the admin-created default avatar when the group id changes', async () => {
    byName = [{ id: 'av-default' }];
    const { assignAvatarAction } = await import('./actions');
    await assignAvatarAction(fd({ heygen_base_avatar_id: 'group-456' }));
    expect(insertAvatar).not.toHaveBeenCalled();
    expect(avatarUpdateEq).toHaveBeenCalledWith('id', 'av-default');
  });

  it('still creates the avatar but does not activate it when the campaign has no profile yet', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { assignAvatarAction } = await import('./actions');
    const r = await assignAvatarAction(fd());
    expect(r).toEqual({ ok: true });
    expect(insertAvatar).toHaveBeenCalled();
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('refuses without consent and reports it', async () => {
    const { assignAvatarAction } = await import('./actions');
    const r = await assignAvatarAction(fd({ consent: 'off' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/consent/i);
    expect(insertAvatar).not.toHaveBeenCalled();
  });
});
