import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { monitoringBearerOk } from '@/lib/monitoring-auth';

// Campaigns actively configured for opponent monitoring — consumed by the
// n8n opposition-monitoring workflow so it can loop over every campaign
// instead of hardcoding a single campaign_id.
export async function GET(req: NextRequest) {
  if (!monitoringBearerOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await adminDb
    .from('candidate_profiles')
    .select(
      'campaign_id, opponent_name, opponent_aliases, monitoring_keywords, opponent_twitter_handle, opponent_instagram_handle, opponent_facebook_page, google_alerts_rss_url, campaigns(name)',
    )
    .not('opponent_name', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaigns = (data ?? []).map((r) => {
    const campaign = r.campaigns as unknown as { name: string } | { name: string }[] | null;
    const campaignName = Array.isArray(campaign) ? campaign[0]?.name : campaign?.name;
    return {
      campaign_id: r.campaign_id,
      campaign_name: campaignName ?? r.campaign_id,
      opponent_name: r.opponent_name,
      opponent_aliases: r.opponent_aliases ?? [],
      monitoring_keywords: r.monitoring_keywords ?? [],
      opponent_twitter_handle: r.opponent_twitter_handle,
      opponent_instagram_handle: r.opponent_instagram_handle,
      opponent_facebook_page: r.opponent_facebook_page,
      google_alerts_rss_url: r.google_alerts_rss_url,
    };
  });

  return NextResponse.json(campaigns);
}
