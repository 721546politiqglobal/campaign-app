import { NextResponse } from 'next/server';

export async function GET() {
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
