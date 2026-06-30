import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ avatars: [] }, { status: 200 });
  }

  const baseId = req.nextUrl.searchParams.get('baseId');

  const res = await fetch('https://api.heygen.com/v2/avatars', {
    headers: { 'X-Api-Key': apiKey },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json({ avatars: [] }, { status: 200 });
  }

  const json = await res.json();
  let avatars: unknown[] = json?.data?.avatars ?? json?.avatars ?? [];

  // Filter to only the campaign's assigned avatar (by base avatar_id)
  if (baseId) {
    avatars = (avatars as { avatar_id?: string }[]).filter(a => a.avatar_id === baseId);
  }

  return NextResponse.json({ avatars });
}
