import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn(async () => ({ error: null, data: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ upsert })) },
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
    body: JSON.stringify(body),
  }) as any;
}

describe('monitoring ingest dedupe via upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONITORING_INGEST_SECRET = 'test-key';
  });

  it('upserts with ignoreDuplicates on the (campaign_id, url) conflict target', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ campaign_id: 'c-1', source: 'NewsData', excerpt: 'x', url: 'https://e.com/a' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const opts = (upsert.mock.calls[0] as unknown[])[1];
    expect(opts).toMatchObject({ onConflict: 'campaign_id,url', ignoreDuplicates: true });
  });
});
