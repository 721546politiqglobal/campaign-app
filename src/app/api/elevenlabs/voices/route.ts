import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  // Was unauthenticated — anyone could enumerate the ElevenLabs voice list (INT-10).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ voices: [], message: 'ELEVENLABS_API_KEY not configured' }, { status: 200 });
  }

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json({ voices: [], error: `ElevenLabs API error: ${res.status}` }, { status: 200 });
  }

  const json = await res.json();
  const voices = json?.voices ?? [];
  return NextResponse.json({ voices });
}
