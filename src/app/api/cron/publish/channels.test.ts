import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { table: string; op: 'select' | 'update' | 'insert'; payload?: Record<string, unknown>; filters: unknown[][] };

const dueItem = { id: 'ci-1', campaign_id: 'c-1', title: 't', body: 'b', media_url: null, platforms: ['x'] };

function fakeDb() {
  const calls: Call[] = [];
  function chain(call: Call): any {
    const c: any = {};
    for (const m of ['eq', 'not', 'lte', 'lt', 'limit', 'select', 'in']) {
      c[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return c; };
    }
    c.then = (resolve: (v: unknown) => void) => {
      if (call.op === 'select') return resolve({ data: [dueItem], error: null });
      if (call.op === 'update' && call.payload?.status === 'publishing') return resolve({ data: [{ id: 'ci-1' }], error: null });
      return resolve({ data: [], error: null });
    };
    return c;
  }
  const adminDb = {
    from: (table: string) => ({
      select: (...a: unknown[]) => { const call: Call = { table, op: 'select', filters: [['select', ...a]] }; calls.push(call); return chain(call); },
      update: (payload: Record<string, unknown>) => { const call: Call = { table, op: 'update', payload, filters: [] }; calls.push(call); return chain(call); },
      insert: (payload: Record<string, unknown>) => { calls.push({ table, op: 'insert', payload, filters: [] }); return Promise.resolve({ error: null }); },
    }),
  };
  return { adminDb, calls };
}

// Review Focus #5: a network disconnected after scheduling must not post.
describe('cron publish requires the campaign channel to be connected', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  async function run(profile: { profileKey: string | null; accounts: any[] }) {
    const db = fakeDb();
    const publish = vi.fn(async () => [{ platform: 'x', status: 'scheduled' }]);
    vi.doMock('@/lib/supabase', () => ({ adminDb: db.adminDb }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ ...profile, syncedAt: null })) }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    return { calls: db.calls, publish };
  }

  it('returns the item to approved and audits, without posting, when the network is not connected', async () => {
    const { calls, publish } = await run({ profileKey: 'pk', accounts: [] });
    expect(publish).not.toHaveBeenCalled();
    expect(calls.some(c => c.op === 'update' && c.payload?.status === 'approved'
      && c.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === 'ci-1'))).toBe(true);
    expect(calls.some(c => c.op === 'insert' && c.payload?.action === 'cron_publish_not_connected')).toBe(true);
  });

  it('publishes with the campaign profile key when connected', async () => {
    const { publish } = await run({ profileKey: 'pk', accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }] });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk' }));
  });

  it('blocks when the campaign has no profile key at all', async () => {
    const { publish } = await run({ profileKey: null, accounts: [] });
    expect(publish).not.toHaveBeenCalled();
  });
});
