import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { publisher } from '@/lib/services';
import { disclosureRepo } from '@/lib/repos';
import { combineDisclosureText } from '@/domain/disclosure';
import type { Platform } from '@/domain/types';
import { getCampaignSocialProfile, type CampaignSocialProfile } from '@/lib/channels';
import { unconnectedPlatforms } from '@/domain/channels';

// Up to 50 sequential publishes, each an external Ayrshare call.
export const maxDuration = 300;

// A row still 'publishing' this long after its claim belongs to a run that was
// killed mid-publish (timeout/crash) — well past maxDuration above.
const STALE_CLAIM_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Release rows a crashed run stranded in 'publishing' (NEW-3). Back to
  // 'approved', not 'scheduled': the post may already have gone out, so a
  // human re-schedules it rather than this cron double-posting.
  await adminDb.from('content_items')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('status', 'publishing')
    .lt('updated_at', new Date(Date.now() - STALE_CLAIM_MS).toISOString());

  const { data: dueItems } = await adminDb
    .from('content_items')
    .select('id, campaign_id, title, body, media_url, platforms')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())
    .limit(50);

  if (!dueItems?.length) {
    return NextResponse.json({ published: 0 });
  }

  const results_out: { id: string; ok: boolean; error?: string }[] = [];

  const profiles = new Map<string, CampaignSocialProfile>();

  for (const item of dueItems) {
    // Atomically claim: only one runner can flip scheduled → publishing. A
    // concurrent run (or a crash-restarted run) that lost the race gets
    // zero rows back and skips, so nothing is published twice (INT-11).
    const { data: claimed, error: claimError } = await adminDb
      .from('content_items')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'scheduled')
      .select('id');
    if (claimError || !claimed || claimed.length === 0) continue;

    try {
      let profile = profiles.get(item.campaign_id);
      if (!profile) {
        profile = await getCampaignSocialProfile(item.campaign_id);
        profiles.set(item.campaign_id, profile);
      }
      const platforms = (item.platforms ?? []) as Platform[];
      const missing = profile.profileKey ? unconnectedPlatforms(platforms, profile.accounts) : platforms;
      if (!profile.profileKey || missing.length > 0) {
        // Never fall back to the Primary Profile (other tenants' accounts).
        await adminDb.from('content_items')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        await adminDb.from('audit_entries').insert({
          campaign_id: item.campaign_id,
          action: 'cron_publish_not_connected',
          entity_type: 'content_item',
          entity_id: item.id,
          details: { missing },
        });
        results_out.push({ id: item.id, ok: false, error: 'channels not connected' });
        continue;
      }
      const disclosures = await disclosureRepo.listFor(item.id);
      const results = await publisher.publish({
        platforms,
        profileKey: profile.profileKey,
        title: item.title, text: item.body,
        disclosureText: combineDisclosureText(disclosures),
        mediaUrl: item.media_url ?? undefined,
      });
      const failed = results.filter(r => r.status === 'failed');
      if (failed.length === results.length) {
        // Every platform rejected — do NOT mark published. Return to 'approved'
        // so it can be re-scheduled, and record the failure for alerting.
        await adminDb.from('content_items')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        await adminDb.from('audit_entries').insert({
          campaign_id: item.campaign_id,
          action: 'cron_publish_failed',
          entity_type: 'content_item',
          entity_id: item.id,
          details: { errors: failed.map(f => ({ platform: f.platform, error: f.error })) },
        });
        results_out.push({ id: item.id, ok: false, error: 'all platforms failed' });
        continue;
      }
      const postIds: Record<string, string> = {};
      for (const r of results) {
        if (r.status === 'scheduled' && r.postId) postIds[r.platform] = r.postId;
      }
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString(), ayrshare_post_ids: postIds })
        .eq('id', item.id);
      await adminDb.from('audit_entries').insert({
        campaign_id: item.campaign_id,
        action: 'cron_publish',
        entity_type: 'content_item',
        entity_id: item.id,
        details: { platforms: item.platforms, failed: failed.map(f => f.platform) },
      });
      results_out.push({ id: item.id, ok: true });
    } catch (e) {
      // Don't leave the claimed row stranded in 'publishing' (NEW-3). Same
      // reasoning as the stale-claim release above: back to 'approved'.
      await adminDb.from('content_items')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      await adminDb.from('audit_entries').insert({
        campaign_id: item.campaign_id,
        action: 'cron_publish_error',
        entity_type: 'content_item',
        entity_id: item.id,
        details: { error: String(e) },
      });
      results_out.push({ id: item.id, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({
    published: results_out.filter(r => r.ok).length,
    failed: results_out.filter(r => !r.ok).length,
    results: results_out,
  });
}
