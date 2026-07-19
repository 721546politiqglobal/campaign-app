import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { scoreCredibility, categorizeSource, isRelevant } from '@/lib/credibility';
import { monitoringBearerOk } from '@/lib/monitoring-auth';
import { uid } from '@/lib/store';

export async function POST(req: NextRequest) {
  if (!monitoringBearerOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    campaign_id?: string;
    source?: string;
    opponent?: string | null;
    excerpt?: string;
    url?: string;
    relevance_terms?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { campaign_id, source, opponent, excerpt, url } = body;

  if (!campaign_id || !source || !excerpt || !url) {
    return NextResponse.json(
      { error: 'Required: campaign_id, source, excerpt, url' },
      { status: 400 },
    );
  }

  // Drop clearly off-topic items before they pollute the feed (UX-5). With no
  // terms configured this keeps everything, so nothing is silently blackholed.
  const terms = Array.isArray(body.relevance_terms) ? body.relevance_terms : [];
  if (!isRelevant(`${excerpt} ${source} ${opponent ?? ''}`, terms)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'off_topic' });
  }

  // Dedup atomically on (campaign_id, url) — a unique index backs this
  // (migration 017). Concurrent ingests can't both insert the same URL any more
  // (audit finding DATA-17); the DB collapses the conflict and we skip.
  const { error: upsertError } = await adminDb
    .from('monitoring_results')
    .upsert(
      {
        id: uid(),
        campaign_id,
        source,
        opponent: opponent || null,
        excerpt: String(excerpt).substring(0, 1000),
        url,
        credibility: scoreCredibility(url),
        category: categorizeSource(url, source),
      },
      { onConflict: 'campaign_id,url', ignoreDuplicates: true },
    );

  if (upsertError) {
    console.error('[monitoring/ingest]', upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
