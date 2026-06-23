import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { scoreCredibility, categorizeSource } from '@/lib/credibility';
import { uid } from '@/lib/store';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    campaign_id?: string;
    source?: string;
    opponent?: string | null;
    excerpt?: string;
    url?: string;
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

  // Dedup — skip if this URL already exists for this campaign
  const { data: existing } = await adminDb
    .from('monitoring_results')
    .select('id')
    .eq('campaign_id', campaign_id)
    .eq('url', url)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate' });
  }

  const { error: insertError } = await adminDb.from('monitoring_results').insert({
    id: uid(),
    campaign_id,
    source,
    opponent: opponent || null,
    excerpt: String(excerpt).substring(0, 1000),
    url,
    credibility: scoreCredibility(url),
    category:    categorizeSource(url, source),
  });

  if (insertError) {
    console.error('[monitoring/ingest]', insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
