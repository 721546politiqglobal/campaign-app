import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn(async () => ({ error: null, data: null }));
// `campaigns` lookup: tests flip `campaignRow` to simulate an unknown id.
const campaignRow: { value: { id: string } | null; error: { message: string } | null } = { value: { id: 'c-1' }, error: null };
const maybeSingle = vi.fn(async () => ({ data: campaignRow.value, error: campaignRow.error }));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
// candidate profile (opponent config) for the campaign
const profileRow: { value: Record<string, unknown> | null } = { value: null };
const profileSelect = vi.fn(() => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow.value, error: null }) }) }));
// recent rows for the syndication check
const recent: { rows: { excerpt: string }[] } = { rows: [] };
const recentSelect = vi.fn(() => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: recent.rows, error: null }) }) }) }) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'campaigns') return { select };
      if (table === 'candidate_profiles') return { select: profileSelect };
      if (table === 'monitoring_results') return { upsert, select: recentSelect };
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
    profileRow.value = null;
    recent.rows = [];
  });

  it('decodes HTML entities and cleans the source name before saving', async () => {
    const { POST } = await import('./route');
    await POST(req({ ...valid, source: 'bostonglobe', url: 'https://www.bostonglobe.com/a', excerpt: '&quot;It&#39;s time&quot; says F&amp;M' }));
    const row = (upsert.mock.calls[0] as unknown[])[0] as { excerpt: string; source: string };
    expect(row.excerpt).toBe('"It\'s time" says F&M');
    expect(row.source).toBe('The Boston Globe');
  });

  it('attributes the opponent server-side when the workflow sent none (surname match)', async () => {
    profileRow.value = { opponent_name: 'Susan Collins', opponent_aliases: [], monitoring_keywords: [] };
    const { POST } = await import('./route');
    await POST(req({ ...valid, excerpt: 'Collins votes against the transit bill' }));
    const row = (upsert.mock.calls[0] as unknown[])[0] as { opponent: string | null };
    expect(row.opponent).toBe('Susan Collins');
  });

  it('drops off-topic items using the campaign profile when the workflow sent no relevance_terms', async () => {
    profileRow.value = { opponent_name: 'Susan Collins', opponent_aliases: ['Sen. Collins'], monitoring_keywords: ['Maine housing'] };
    const { isRelevant } = await import('@/lib/credibility');
    vi.mocked(isRelevant).mockReturnValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(req({ ...valid, excerpt: 'Russian aerial bombs hit Zaporizhzhia' }));
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'off_topic' });
    expect(vi.mocked(isRelevant).mock.calls[0][1]).toEqual(['Susan Collins', 'Sen. Collins', 'Maine housing', 'Collins']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips a syndicated copy of a story already captured from another outlet', async () => {
    recent.rows = [{ excerpt: 'Sen. Susan Collins is no longer Maine’s senator, critics said on Monday' }];
    const { POST } = await import('./route');
    const res = await POST(req({ ...valid, url: 'https://other.example/b', excerpt: 'sen susan collins is no longer maine\'s senator critics said on monday' }));
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'duplicate_story' });
    expect(upsert).not.toHaveBeenCalled();
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
