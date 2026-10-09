import { describe, it, expect, vi, beforeEach } from 'vitest';

// NEW-3: a row the cron has claimed (status = 'publishing') must never be left
// there forever — neither when publishing throws mid-run, nor when the whole
// function is killed (timeout/crash) before it can write a final status.
// Recovery returns the item to 'approved' (needs a human to re-schedule) rather
// than 'scheduled': the post may already have gone out, and auto-retrying
// would double-post.

type Call = { table: string; op: 'select' | 'update' | 'insert'; payload?: Record<string, unknown>; filters: unknown[][] };

const dueItem = { id: 'ci-1', campaign_id: 'c-1', title: 't', body: 'b', media_url: null, platforms: ['x'] };

function fakeDb() {
  const calls: Call[] = [];
  function chain(call: Call): any {
    const c: any = {};
    for (const m of ['eq', 'not', 'lte', 'lt', 'order', 'limit', 'select', 'in']) {
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

async function runCron(publish: () => Promise<unknown>) {
  const db = fakeDb();
  vi.doMock('@/lib/supabase', () => ({ adminDb: db.adminDb }));
  vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
  vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
  vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ profileKey: 'pk', syncedAt: null, accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }] })) }));
  const { GET } = await import('./route');
  const { NextRequest } = await import('next/server');
  await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
  return db.calls;
}

describe('cron publish never strands an item in "publishing"', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('returns the item to approved (and audits it) when publishing throws', async () => {
    const calls = await runCron(() => Promise.reject(new Error('Ayrshare timeout')));
    const reset = calls.find(c => c.op === 'update' && c.payload?.status === 'approved'
      && c.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === 'ci-1'));
    expect(reset).toBeDefined();
    expect(calls.some(c => c.op === 'insert' && c.table === 'audit_entries' && c.payload?.action === 'cron_publish_error')).toBe(true);
  });

  it('releases rows a previous crashed run left in publishing for too long', async () => {
    const calls = await runCron(() => Promise.resolve([{ platform: 'x', status: 'scheduled' }]));
    const release = calls.find(c => c.op === 'update' && c.payload?.status === 'approved'
      && c.filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'publishing')
      && c.filters.some(f => f[0] === 'lt' && f[1] === 'updated_at'));
    expect(release).toBeDefined();
  });
});
