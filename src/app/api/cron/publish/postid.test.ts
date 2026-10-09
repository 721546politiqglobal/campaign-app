import { describe, it, expect, vi, beforeEach } from 'vitest';

const dueItem = { id: 'ci-1', campaign_id: 'c-1', body: 'b', media_url: null, platforms: ['x'] };

// Mirrors the shape in claim.test.ts: the due-items SELECT terminates at
// .limit(), the claiming UPDATE terminates at .select(), and the final
// status UPDATE terminates at .eq() — its payload is what we assert on.
function makeAdminDb(payloads: Record<string, unknown>[]) {
  const selectDue: any = { eq: () => selectDue, not: () => selectDue, lte: () => selectDue, order: () => selectDue, limit: () => Promise.resolve({ data: [dueItem], error: null }) };
  const claim: any = { eq: () => claim, select: () => Promise.resolve({ data: [{ id: 'ci-1' }], error: null }) };
  const staleRelease: any = { eq: () => ({ lt: () => Promise.resolve({ error: null }) }) };
  let updateCalls = 0;
  return {
    from: () => ({
      select: () => selectDue,
      update: (payload: Record<string, unknown>) => {
        // The run opens by releasing stale 'publishing' claims (.eq().lt());
        // see recovery.test.ts. Not counted as one of the per-item updates.
        if (updateCalls === 0 && payload.status === 'approved') return staleRelease;
        updateCalls += 1;
        if (updateCalls === 1) return claim;
        payloads.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: () => Promise.resolve({ error: null }),
    }),
  };
}

describe('cron publish persists ayrshare post ids', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('stores the returned postId per platform when marking published', async () => {
    const payloads: Record<string, unknown>[] = [];
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb(payloads) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish: vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled', postId: 'post-123' }])) } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ profileKey: 'pk', syncedAt: null, accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }] })) }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));

    expect(payloads[0]).toMatchObject({ status: 'published', ayrshare_post_ids: { x: 'post-123' } });
  });

  it('stores an empty map (without failing) when no platform returned a postId', async () => {
    const payloads: Record<string, unknown>[] = [];
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb(payloads) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish: vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled' }])) } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ profileKey: 'pk', syncedAt: null, accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }] })) }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));

    expect(payloads[0]).toMatchObject({ status: 'published', ayrshare_post_ids: {} });
  });
});
