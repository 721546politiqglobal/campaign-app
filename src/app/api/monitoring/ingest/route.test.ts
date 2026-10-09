import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn(async () => ({ error: null, data: null }));
// `campaigns` lookup: tests flip `campaignRow` to simulate an unknown id.
const campaignRow: { value: { id: string } | null; error: { message: string } | null } = { value: { id: 'c-1' }, error: null };
const maybeSingle = vi.fn(async () => ({ data: campaignRow.value, error: campaignRow.error }));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'campaigns') return { select };
      if (table === 'monitoring_results') return { upsert };
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));
vi.mock('@/lib/credibility', () => ({
  scoreCredibility: vi.fn(() => 'medium'),
  categorizeSource: vi.fn(() => 'news'),
  isRelevant: vi.fn(() => true),
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'mr-1') }));

function req(body: unknown) {
  return new Request('http://x/api/monitoring/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.MONITORING_INGEST_SECRET}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;
}

const valid = { campaign_id: 'c-1', source: 'NewsData', excerpt: 'x', url: 'https://e.com/a' };

describe('monitoring ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONITORING_INGEST_SECRET = 'test-key';
    campaignRow.value = { id: 'c-1' };
    campaignRow.error = null;
  });

  it('upserts with ignoreDuplicates on the (campaign_id, url) conflict target', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const opts = (upsert.mock.calls[0] as unknown[])[1];
    expect(opts).toMatchObject({ onConflict: 'campaign_id,url', ignoreDuplicates: true });
  });

  it('verifies the campaign exists and answers 404 (not a raw PG error) for an unknown id', async () => {
    campaignRow.value = null;
    const { POST } = await import('./route');
    const res = await POST(req({ ...valid, campaign_id: 'nope' }));
    expect(res.status).toBe(404);
    expect(eq).toHaveBeenCalledWith('id', 'nope');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) url with 400', async () => {
    const { POST } = await import('./route');
    for (const url of ['javascript:alert(1)', 'ftp://e.com/a', 'not a url', 'e.com/a']) {
      const res = await POST(req({ ...valid, url }));
      expect(res.status, url).toBe(400);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it('enforces length limits on source and opponent', async () => {
    const { POST } = await import('./route');
    expect((await POST(req({ ...valid, source: 'x'.repeat(201) }))).status).toBe(400);
    expect((await POST(req({ ...valid, opponent: 'x'.repeat(201) }))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('truncates the excerpt to 1000 characters instead of rejecting it', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ ...valid, excerpt: 'y'.repeat(5000) }));
    expect(res.status).toBe(200);
    const row = (upsert.mock.calls[0] as unknown[])[0] as { excerpt: string };
    expect(row.excerpt).toHaveLength(1000);
  });

  it('rejects non-string field types and invalid JSON with 400', async () => {
    const { POST } = await import('./route');
    expect((await POST(req({ ...valid, source: 42 }))).status).toBe(400);
    expect((await POST(req('{not json'))).status).toBe(400);
  });

  it('does not leak the database error message on a failed upsert', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'relation "monitoring_results" violates fk' } as never, data: null });
    const { POST } = await import('./route');
    const res = await POST(req(valid));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('violates fk');
  });
});
