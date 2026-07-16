import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const meterCreate = vi.fn(() => Promise.resolve({}));

vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(), rpc } }));
vi.mock('@/lib/stripe', () => ({ stripe: { billing: { meterEvents: { create: meterCreate } } } }));

// Minimal chainable query-builder: terminals resolve to { data, error }.
function makeFrom(fixtures: Record<string, any>, capture?: (row: any) => void) {
  return (table: string) => {
    const rows = fixtures[table];
    const chain: any = {
      select: () => chain, not: () => chain, in: () => chain,
      eq: () => chain, neq: () => chain, gt: () => chain, lte: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows?.single ?? null, error: null }),
      upsert: (row: any) => { capture?.(row); return Promise.resolve({ error: null }); },
      then: (r: any) => Promise.resolve({ data: rows?.list ?? [], error: null }).then(r),
    };
    return chain;
  };
}

const CAMPAIGNS = { list: [{ id: 'c-1', stripe_customer_id: 'cus_1', subscription_status: 'active' }] };
const CURSOR = { single: { last_synced_at: '2026-07-01T00:00:00Z' } };
const EVENTS = { list: [{ cost_cents: 500 }] };

describe('billing-sync single-flight + safety lag', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's'; });

  it('skips a campaign whose sync lease is already held', async () => {
    const supa = await import('@/lib/supabase');
    (supa.adminDb.from as any).mockImplementation(makeFrom({ campaigns: CAMPAIGNS, usage_sync_cursor: CURSOR, usage_events: EVENTS }));
    rpc.mockResolvedValue({ data: false, error: null }); // claim denied
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
    const body = await res.json();
    expect(rpc).toHaveBeenCalledWith('claim_usage_sync', expect.objectContaining({ p_campaign_id: 'c-1' }));
    expect(meterCreate).not.toHaveBeenCalled();
    expect(body.results[0]).toMatchObject({ campaignId: 'c-1', synced: false });
  });

  it('reports and releases the lease when it holds the claim', async () => {
    const supa = await import('@/lib/supabase');
    (supa.adminDb.from as any).mockImplementation(makeFrom({ campaigns: CAMPAIGNS, usage_sync_cursor: CURSOR, usage_events: EVENTS }));
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'claim_usage_sync', error: null }));
    const { GET } = await import('./route');
    await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
    expect(meterCreate).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('release_usage_sync', { p_campaign_id: 'c-1' });
  });

  it('persists a pending_until that trails wall-clock by the safety lag', async () => {
    const upserts: any[] = [];
    const supa = await import('@/lib/supabase');
    (supa.adminDb.from as any).mockImplementation(makeFrom({ campaigns: CAMPAIGNS, usage_sync_cursor: CURSOR, usage_events: EVENTS }, r => upserts.push(r)));
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'claim_usage_sync', error: null }));
    const t0 = Date.now();
    const { GET } = await import('./route');
    await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
    const pending = upserts.find(u => u.pending_until);
    expect(new Date(pending.pending_until).getTime()).toBeLessThanOrEqual(t0 - 30_000);
  });
});
