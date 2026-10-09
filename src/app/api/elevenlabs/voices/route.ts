import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';

interface ElevenLabsVoice { voice_id: string; [k: string]: unknown }

export async function GET() {
  // Was unauthenticated — anyone could enumerate the ElevenLabs voice list (INT-10).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The ElevenLabs account is shared across every campaign, so the raw voice
  // list includes other tenants' cloned voices. A campaign user only ever sees
  // the voice assigned to their own campaign; super_admin (who assigns voices)
  // gets the full list.
  let allowedIds: Set<string> | null = null;
  if (session.role !== 'super_admin') {
    const profile = session.campaignId ? await getCandidateProfile(session.campaignId) : null;
    const ownVoiceId = profile?.elevenLabsVoiceId;
    if (!ownVoiceId) return NextResponse.json({ voices: [] });
    allowedIds = new Set([ownVoiceId]);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ voices: [], message: 'ELEVENLABS_API_KEY not configured' }, { status: 200 });
  }

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    console.error('[elevenlabs/voices] upstream error', res.status);
    return NextResponse.json({ voices: [], error: 'Voice service unavailable' }, { status: 200 });
  }

  const json = await res.json();
  const all: ElevenLabsVoice[] = Array.isArray(json?.voices) ? json.voices : [];
  const voices = allowedIds ? all.filter(v => allowedIds.has(v.voice_id)) : all;
  return NextResponse.json({ voices });
}
