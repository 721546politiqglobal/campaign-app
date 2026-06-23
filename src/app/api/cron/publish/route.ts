import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { publisher } from '@/lib/services';
import { disclosureRepo } from '@/lib/repos';
import type { Platform } from '@/domain/types';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: dueItems } = await adminDb
    .from('content_items')
    .select('id, campaign_id, body, media_url, platforms')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString());

  if (!dueItems?.length) {
    return NextResponse.json({ published: 0 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const item of dueItems) {
    try {
      const disclosures = await disclosureRepo.listFor(item.id);
      await publisher.publish({
        platforms: (item.platforms ?? []) as Platform[],
        text: item.body,
        disclosureText: disclosures[0]?.disclosureText ?? '',
        mediaUrl: item.media_url ?? undefined,
      });
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      await adminDb.from('audit_entries').insert({
        campaign_id: item.campaign_id,
        action: 'cron_publish',
        entity_type: 'content_item',
        entity_id: item.id,
        details: { platforms: item.platforms },
      });
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({
    published: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}
