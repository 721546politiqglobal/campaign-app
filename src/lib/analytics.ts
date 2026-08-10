import Anthropic from '@anthropic-ai/sdk';
import { adminDb, throwOnError } from './supabase';

export interface PerformanceTotals {
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number;
  engagement: number; postsCount: number;
}

export interface PerformanceSummary {
  totals: PerformanceTotals;
  priorTotals: { impressions: number; reach: number; engagement: number; videoViews: number };
  byPlatform: { platform: string; engagement: number }[];
  byContentType: { type: string; engagement: number }[];
  topContent: { id: string; title: string; type: string; platforms: string[]; engagement: number }[];
}

interface PostMetricRow {
  content_item_id: string; platform: string; captured_on: string;
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; video_views: number; video_avg_watch_seconds: number;
}

function engagementOf(m: PostMetricRow): number {
  return m.likes + m.comments + m.shares + m.saves;
}

function sumField(rows: PostMetricRow[], field: 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'video_views' | 'video_avg_watch_seconds'): number {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

export async function getPerformanceSummary(
  campaignId: string, days = 30, now: Date = new Date(),
): Promise<PerformanceSummary> {
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const sinceDate = new Date(now); sinceDate.setDate(sinceDate.getDate() - days);
  const priorSinceDate = new Date(now); priorSinceDate.setDate(priorSinceDate.getDate() - days * 2);
  const sinceStr = toDateStr(sinceDate);
  const priorSinceStr = toDateStr(priorSinceDate);

  const { data } = await adminDb
    .from('post_metrics')
    .select('*')
    .eq('campaign_id', campaignId)
    .gte('captured_on', priorSinceStr);
  const rows = (data ?? []) as PostMetricRow[];

  const current = rows.filter(r => r.captured_on >= sinceStr);
  const prior = rows.filter(r => r.captured_on < sinceStr);

  const totals: PerformanceTotals = {
    impressions: sumField(current, 'impressions'),
    reach: sumField(current, 'reach'),
    likes: sumField(current, 'likes'),
    comments: sumField(current, 'comments'),
    shares: sumField(current, 'shares'),
    saves: sumField(current, 'saves'),
    videoViews: sumField(current, 'video_views'),
    videoAvgWatchSeconds: current.length ? sumField(current, 'video_avg_watch_seconds') / current.length : 0,
    engagement: current.reduce((total, m) => total + engagementOf(m), 0),
    postsCount: new Set(current.map(r => r.content_item_id)).size,
  };
  const priorTotals = {
    impressions: sumField(prior, 'impressions'),
    reach: sumField(prior, 'reach'),
    videoViews: sumField(prior, 'video_views'),
    engagement: prior.reduce((total, m) => total + engagementOf(m), 0),
  };

  const contentItemIds = [...new Set(current.map(r => r.content_item_id))];
  const itemRows = contentItemIds.length
    ? (await adminDb.from('content_items').select('id, title, type, platforms').in('id', contentItemIds)).data
    : [];
  const itemsById = new Map((itemRows ?? []).map((r: any) => [r.id as string, r]));

  const byPlatformMap = new Map<string, number>();
  const byTypeMap = new Map<string, number>();
  const engagementByItem = new Map<string, number>();
  for (const m of current) {
    const e = engagementOf(m);
    byPlatformMap.set(m.platform, (byPlatformMap.get(m.platform) ?? 0) + e);
    engagementByItem.set(m.content_item_id, (engagementByItem.get(m.content_item_id) ?? 0) + e);
    const item = itemsById.get(m.content_item_id);
    if (item) byTypeMap.set(item.type, (byTypeMap.get(item.type) ?? 0) + e);
  }

  const topContent = [...engagementByItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, engagement]) => {
      const item = itemsById.get(id);
      return {
        id, engagement,
        title: item?.title ?? 'Untitled',
        type: item?.type ?? 'unknown',
        platforms: item?.platforms ?? [],
      };
    });

  return {
    totals, priorTotals,
    byPlatform: [...byPlatformMap.entries()].map(([platform, engagement]) => ({ platform, engagement })),
    byContentType: [...byTypeMap.entries()].map(([type, engagement]) => ({ type, engagement })),
    topContent,
  };
}

export async function upsertPostMetrics(input: {
  campaignId: string; contentItemId: string; platform: string;
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await throwOnError(
    adminDb.from('post_metrics').upsert({
      campaign_id: input.campaignId,
      content_item_id: input.contentItemId,
      platform: input.platform,
      captured_on: today,
      impressions: input.impressions,
      reach: input.reach,
      likes: input.likes,
      comments: input.comments,
      shares: input.shares,
      saves: input.saves,
      video_views: input.videoViews,
      video_avg_watch_seconds: input.videoAvgWatchSeconds,
    }, { onConflict: 'content_item_id,platform,captured_on' }),
    'upsertPostMetrics',
  );
}

export async function generateInsight(
  campaignId: string,
  now: Date = new Date(),
  anthropicClient?: { messages: { create: (...args: any[]) => Promise<any> } },
): Promise<{ summary: string; recommendations: string[] } | null> {
  if (!anthropicClient && !process.env.LLM_API_KEY) return null;

  const summary = await getPerformanceSummary(campaignId, 30, now);
  if (summary.totals.postsCount === 0) return null;

  const client = anthropicClient ?? new Anthropic({ apiKey: process.env.LLM_API_KEY! });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: 'You are a political campaign performance analyst. Given 30 days of social content metrics as JSON, write a concise, honest summary and 2-3 concrete recommendations. Respond ONLY in this exact format:\nSummary: <2-3 sentences>\nRecommendations:\n- <recommendation>\n- <recommendation>',
    messages: [{ role: 'user', content: JSON.stringify(summary) }],
  });

  const block = msg.content[0];
  if (!block || block.type !== 'text') return null;

  const text = block.text as string;
  const summaryMatch = text.match(/Summary:\s*(.+?)(?=\n\s*Recommendations:|$)/s);
  const recommendations = text
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.replace(/^\s*-\s*/, '').trim());

  return {
    summary: summaryMatch ? summaryMatch[1].trim() : text.trim(),
    recommendations,
  };
}

export async function insertInsightSnapshot(
  campaignId: string, insight: { summary: string; recommendations: string[] },
): Promise<void> {
  await throwOnError(
    adminDb.from('insight_snapshots').insert({
      campaign_id: campaignId,
      summary: insight.summary,
      recommendations: insight.recommendations,
    }),
    'insertInsightSnapshot',
  );
}

export async function getLatestInsight(
  campaignId: string,
): Promise<{ summary: string; recommendations: string[]; generatedAt: string } | null> {
  const { data } = await adminDb
    .from('insight_snapshots')
    .select('summary, recommendations, generated_at')
    .eq('campaign_id', campaignId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { summary: data.summary, recommendations: data.recommendations ?? [], generatedAt: data.generated_at };
}
