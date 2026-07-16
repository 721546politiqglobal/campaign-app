import { describe, it, expect, vi, beforeEach } from 'vitest';

const publish = vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled' }]));
vi.mock('@/lib/services', () => ({ publisher: { publish } }));
vi.mock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));

const dueItem = { id: 'ci-1', campaign_id: 'c-1', body: 'b', media_url: null, platforms: ['x'] };

// Due-items SELECT terminates at .limit(); the claiming UPDATE terminates at
// .select() and returns `claimRows`; the final status UPDATE terminates at .eq().
function makeAdminDb(claimRows: unknown[]) {
  const selectDue: any = { eq: () => selectDue, not: () => selectDue, lte: () => selectDue, limit: () => Promise.resolve({ data: [dueItem], error: null }) };
  const claim: any = { eq: () => claim, select: () => Promise.resolve({ data: claimRows, error: null }) };
  const finalUpdate: any = { eq: () => Promise.resolve({ error: null }) };
  let updateCalls = 0;
  return {
    from: () => ({
      select: () => selectDue,
      update: () => { updateCalls += 1; return updateCalls === 1 ? claim : finalUpdate; },
      insert: () => Promise.resolve({ error: null }),
    }),
  };
}

describe('cron publish atomic claim', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('skips publishing an item it did not win the claim on', async () => {
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([]) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes an item it does win the claim on', async () => {
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([{ id: 'ci-1' }]) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
