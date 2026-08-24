import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { analyticsProvider } from '@/lib/services';
import { upsertPostMetrics, generateInsight, insertInsightSnapshot } from '@/lib/analytics';
import type { Platform } from '@/domain/types';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);

  const { data: items } = await adminDb
    .from('content_items')
    .select('id, campaign_id, ayrshare_post_ids')
    .eq('status', 'published')
    .gte('updated_at', cutoff.toISOString())
    .limit(200);

  const campaignIds = new Set<string>();
  let synced = 0;
  let failed = 0;

  for (const item of items ?? []) {
    const postIds = (item.ayrshare_post_ids ?? {}) as Record<string, string>;
    const posts = Object.entries(postIds).map(([platform, postId]) => ({ platform: platform as Platform, postId }));
    if (posts.length === 0) continue;

    try {
      const metrics = await analyticsProvider.getPostAnalytics(posts);
      for (const m of metrics) {
        await upsertPostMetrics({
          campaignId: item.campaign_id, contentItemId: item.id, platform: m.platform,
          impressions: m.impressions, reach: m.reach, likes: m.likes, comments: m.comments,
          shares: m.shares, saves: m.saves, videoViews: m.videoViews, videoAvgWatchSeconds: m.videoAvgWatchSeconds,
        });
      }
      campaignIds.add(item.campaign_id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  let insightsGenerated = 0;
  for (const campaignId of campaignIds) {
    try {
      const insight = await generateInsight(campaignId);
      if (insight) {
        await insertInsightSnapshot(campaignId, insight);
        insightsGenerated += 1;
      }
    } catch {
      // one campaign's insight failure must not block the others
    }
  }

  return NextResponse.json({ synced, failed, insightsGenerated });
}
