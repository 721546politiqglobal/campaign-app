import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

function mockPerformanceData(rows: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === 'post_metrics') return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: rows, error: null }) }) }) };
    if (table === 'content_items') return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    throw new Error(`unexpected table ${table}`);
  });
}

const SOME_METRICS = [{ content_item_id: 'ci-1', platform: 'x', captured_on: '2026-08-05', impressions: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 0, video_views: 0, video_avg_watch_seconds: 0 }];

beforeEach(() => { vi.clearAllMocks(); delete process.env.LLM_API_KEY; });

describe('generateInsight', () => {
  it('returns null when there is no injected client and LLM_API_KEY is unset', async () => {
    mockPerformanceData(SOME_METRICS);
    const { generateInsight } = await import('./analytics');
    expect(await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'))).toBeNull();
  });

  it('returns null (and never calls Claude) when there is no performance data yet', async () => {
    mockPerformanceData([]);
    const create = vi.fn();
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('parses the summary and recommendations out of a well-formed Claude response', async () => {
    mockPerformanceData(SOME_METRICS);
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Summary: Engagement is trending up nicely.\n\nRecommendations:\n- Post more video content\n- Respond to the opponent on healthcare' }],
    });
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toEqual({
      summary: 'Engagement is trending up nicely.',
      recommendations: ['Post more video content', 'Respond to the opponent on healthcare'],
    });
  });

  it('returns null instead of throwing when Claude returns no usable text block', async () => {
    mockPerformanceData(SOME_METRICS);
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'refusal' });
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toBeNull();
  });
});

describe('insertInsightSnapshot', () => {
  it('inserts a snapshot row with the campaign id and insight fields', async () => {
    const insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') return { insert };
      throw new Error(`unexpected table ${table}`);
    });
    const { insertInsightSnapshot } = await import('./analytics');
    await insertInsightSnapshot('c-1', { summary: 'S', recommendations: ['R1'] });
    expect(insert).toHaveBeenCalledWith({ campaign_id: 'c-1', summary: 'S', recommendations: ['R1'] });
  });
});

describe('getLatestInsight', () => {
  it('returns null when no snapshot exists yet', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { getLatestInsight } = await import('./analytics');
    expect(await getLatestInsight('c-1')).toBeNull();
  });

  it('maps the most recent row to camelCase', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { summary: 'S', recommendations: ['R1'], generated_at: '2026-08-09T00:00:00Z' }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { getLatestInsight } = await import('./analytics');
    expect(await getLatestInsight('c-1')).toEqual({ summary: 'S', recommendations: ['R1'], generatedAt: '2026-08-09T00:00:00Z' });
  });
});
