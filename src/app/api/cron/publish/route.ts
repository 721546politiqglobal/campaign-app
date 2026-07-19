import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { publisher } from '@/lib/services';
import { disclosureRepo } from '@/lib/repos';
import { combineDisclosureText } from '@/domain/disclosure';
import type { Platform } from '@/domain/types';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: dueItems } = await adminDb
    .from('content_items')
    .select('id, campaign_id, body, media_url, platforms')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())
    .limit(50);

  if (!dueItems?.length) {
    return NextResponse.json({ published: 0 });
  }

  const results_out: { id: string; ok: boolean; error?: string }[] = [];

  for (const item of dueItems) {
    // Atomically claim: only one runner can flip scheduled → publishing. A
    // concurrent 5-min run (or a crash-restarted run) that lost the race gets
    // zero rows back and skips, so nothing is published twice (INT-11).
    const { data: claimed, error: claimError } = await adminDb
      .from('content_items')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'scheduled')
      .select('id');
    if (claimError || !claimed || claimed.length === 0) continue;

    try {
      const disclosures = await disclosureRepo.listFor(item.id);
      const results = await publisher.publish({
        platforms: (item.platforms ?? []) as Platform[],
        text: item.body,
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
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString() })
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
      results_out.push({ id: item.id, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({
    published: results_out.filter(r => r.ok).length,
    failed: results_out.filter(r => !r.ok).length,
    results: results_out,
  });
}
