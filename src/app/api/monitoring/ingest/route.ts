import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { scoreCredibility, categorizeSource, isRelevant } from '@/lib/credibility';
import { monitoringBearerOk } from '@/lib/monitoring-auth';
import { uid } from '@/lib/store';
import { cleanText, sourceDisplayName, matchOpponent, relevanceTermsFor, excerptFingerprint } from '@/lib/monitoring-normalize';

// How far back to look for a syndicated copy of the same story.
const SYNDICATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SYNDICATION_SCAN_LIMIT = 300;

// Field limits. Excerpts are truncated (the feed only ever shows a clamp of
// them); everything else is rejected so a misconfigured workflow fails loudly.
// (Not exported: Next.js only allows handler exports from a route module.)
const MAX_SOURCE_LEN = 200;
const MAX_OPPONENT_LEN = 200;
const MAX_URL_LEN = 2048;
const MAX_EXCERPT_LEN = 1000;
const MAX_CAMPAIGN_ID_LEN = 64;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  if (!monitoringBearerOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const campaign_id = str(body.campaign_id);
  const rawSource = str(body.source);
  const rawExcerpt = str(body.excerpt);
  const url = str(body.url);
  const rawOpponent = str(body.opponent);
  // Feeds (YouTube, RSS) leave HTML entities/tags in titles; clean before
  // validating so a markup-only excerpt counts as empty.
  const excerpt = rawExcerpt === null ? null : cleanText(rawExcerpt);
  const source = rawSource === null ? null : cleanText(rawSource);
  const opponent = rawOpponent === null ? null : cleanText(rawOpponent);

  if (!campaign_id || !source || !excerpt || !url) {
    return NextResponse.json(
      { error: 'Required: campaign_id, source, excerpt, url' },
      { status: 400 },
    );
  }
  if (campaign_id.length > MAX_CAMPAIGN_ID_LEN) {
    return NextResponse.json({ error: 'Invalid campaign_id' }, { status: 400 });
  }
  if (source.length > MAX_SOURCE_LEN) {
    return NextResponse.json({ error: `source must be at most ${MAX_SOURCE_LEN} characters` }, { status: 400 });
  }
  if (opponent && opponent.length > MAX_OPPONENT_LEN) {
    return NextResponse.json({ error: `opponent must be at most ${MAX_OPPONENT_LEN} characters` }, { status: 400 });
  }
  if (url.length > MAX_URL_LEN || !isHttpUrl(url)) {
    return NextResponse.json({ error: 'url must be an http(s) URL' }, { status: 400 });
  }

  // An unknown campaign_id used to surface as a raw foreign-key error from
  // Postgres (and a 500). Check it up front and answer with a clean 404.
  const { data: campaign, error: campaignError } = await adminDb
    .from('campaigns')
    .select('id')
    .eq('id', campaign_id)
    .maybeSingle();
  if (campaignError) {
    console.error('[monitoring/ingest] campaign lookup failed', campaignError);
    return NextResponse.json({ error: 'Could not verify campaign' }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: 'Unknown campaign_id' }, { status: 404 });
  }

  const { data: profile } = await adminDb
    .from('candidate_profiles')
    .select('full_name, office, district, opponent_name, opponent_aliases, monitoring_keywords')
    .eq('campaign_id', campaign_id)
    .maybeSingle();
  const opp = {
    opponentName: (profile?.opponent_name as string | null) ?? null,
    aliases: ((profile?.opponent_aliases as string[] | null) ?? []).filter(Boolean),
    keywords: ((profile?.monitoring_keywords as string[] | null) ?? []).filter(Boolean),
  };

  // Drop clearly off-topic items before they pollute the feed (UX-5). Workflows
  // may send their own relevance_terms; otherwise derive them from the
  // campaign's opponent config. With no terms at all this keeps everything, so
  // nothing is silently blackholed.
  const sentTerms = Array.isArray(body.relevance_terms)
    ? (body.relevance_terms as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const terms = sentTerms.length ? sentTerms : relevanceTermsFor(opp);
  if (!isRelevant(`${excerpt} ${source} ${opponent ?? ''}`, terms)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'off_topic' });
  }

  // Already captured this exact URL (e.g. the same latest Instagram posts every
  // run) → skip before spending an AI triage call on it.
  const { data: existing } = await adminDb
    .from('monitoring_results')
    .select('id')
    .eq('campaign_id', campaign_id)
    .eq('url', url)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate_url' });
  }

  // The same wire story republished by several outlets → keep the first copy.
  const fingerprint = excerptFingerprint(excerpt);
  if (fingerprint) {
    const { data: recentRows } = await adminDb
      .from('monitoring_results')
      .select('excerpt')
      .eq('campaign_id', campaign_id)
      .gte('captured_at', new Date(Date.now() - SYNDICATION_WINDOW_MS).toISOString())
      .order('captured_at', { ascending: false })
      .limit(SYNDICATION_SCAN_LIMIT);
    if ((recentRows ?? []).some(r => excerptFingerprint(String(r.excerpt ?? '')) === fingerprint)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate_story' });
    }
  }

  // Dedup atomically on (campaign_id, url) — a unique index backs this
  // (migration 017). Concurrent ingests can't both insert the same URL any more
  // (audit finding DATA-17); the DB collapses the conflict and we skip.
  // AI triage: how much this story matters to the campaign. Never blocks the
  // save — any failure (missing key, timeout, refusal) records 'relevant'.
  const finalOpponent = opponent || matchOpponent(`${excerpt} ${source}`, opp);
  let triage: { level: string; reason: string | null } = { level: 'relevant', reason: null };
  try {
    const { monitoringTriager } = await import('@/lib/services');
    triage = await monitoringTriager.triage(
      { source: sourceDisplayName(source, url), excerpt: excerpt.substring(0, MAX_EXCERPT_LEN), url, opponent: finalOpponent },
      {
        candidateName: (profile?.full_name as string | null) ?? null,
        office: (profile?.office as string | null) ?? null,
        district: (profile?.district as string | null) ?? null,
        opponentName: opp.opponentName, aliases: opp.aliases, keywords: opp.keywords,
      },
    );
  } catch (e) {
    console.error('[monitoring/ingest] triage failed', e instanceof Error ? e.message : e);
  }

  const row = {
    id: uid(),
    campaign_id,
    source: sourceDisplayName(source, url),
    opponent: finalOpponent,
    excerpt: excerpt.substring(0, MAX_EXCERPT_LEN),
    url,
    credibility: scoreCredibility(url),
    category: categorizeSource(url, source),
    triage_level: triage.level,
    triage_reason: triage.reason,
  };
  const save = (r: Record<string, unknown>) => adminDb
    .from('monitoring_results')
    .upsert(r, { onConflict: 'campaign_id,url', ignoreDuplicates: true });
  let { error: upsertError } = await save(row);
  // Deployed before migration 045 (triage columns)? Save the story without
  // triage rather than dropping it.
  if (upsertError && /triage_(level|reason)/.test(String(upsertError.message ?? ''))) {
    console.error('[monitoring/ingest] triage columns missing — run migration 045', upsertError.message);
    const { triage_level: _l, triage_reason: _r, ...withoutTriage } = row;
    ({ error: upsertError } = await save(withoutTriage));
  }

  if (upsertError) {
    console.error('[monitoring/ingest]', upsertError);
    return NextResponse.json({ error: 'Could not save monitoring result' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
