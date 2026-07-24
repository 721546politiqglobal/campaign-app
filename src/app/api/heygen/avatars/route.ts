import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

interface NormalizedAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

export async function GET(req: NextRequest) {
  // Was unauthenticated — anyone could probe HeyGen avatar groups and burn the
  // app's provider rate limits (INT-10).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ avatars: [] });

  const baseId = req.nextUrl.searchParams.get('baseId');

  // If a base ID is supplied, try photo-avatar group first (talking photos),
  // then fall back to filtering studio avatars by avatar_id.
  if (baseId) {
    // ── Photo avatar group ─────────────────────────────────────────────────
    const groupRes = await fetch(
      `https://api.heygen.com/v2/avatar_group/${encodeURIComponent(baseId)}/avatars`,
      { headers: { 'X-Api-Key': apiKey }, next: { revalidate: 300 } },
    );

    if (groupRes.ok) {
      const groupJson = await groupRes.json();
      // The real v2 response uses avatar_id/avatar_name/preview_image_url/
      // preview_video_url (no `status` field) — NOT id/name/image_url/
      // motion_preview_url. Every entry in avatar_list is already a usable
      // look, so there's nothing to filter on beyond having an avatar_id.
      const list: { avatar_id?: string; avatar_name?: string; preview_image_url?: string; preview_video_url?: string }[] =
        groupJson?.data?.avatar_list ?? [];

      const photoAvatars: NormalizedAvatar[] = list
        .filter(a => a.avatar_id)
        .map(a => ({
          avatar_id: a.avatar_id!,
          avatar_name: a.avatar_name ?? 'Look',
          preview_image_url: a.preview_image_url,
          preview_video_url: a.preview_video_url,
        }));

      if (photoAvatars.length > 0) {
        return NextResponse.json({ avatars: photoAvatars });
      }
    }

    // ── Studio avatar fallback ─────────────────────────────────────────────
    const studioRes = await fetch('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': apiKey },
      next: { revalidate: 300 },
    });

    if (!studioRes.ok) return NextResponse.json({ avatars: [] });

    const studioJson = await studioRes.json();
    const studioAll: { avatar_id?: string; avatar_name?: string; preview_image_url?: string; preview_video_url?: string }[] =
      studioJson?.data?.avatars ?? studioJson?.avatars ?? [];

    const studioAvatars: NormalizedAvatar[] = studioAll
      .filter(a => a.avatar_id === baseId)
      .map(a => ({
        avatar_id: a.avatar_id!,
        avatar_name: a.avatar_name ?? 'Look',
        preview_image_url: a.preview_image_url,
        preview_video_url: a.preview_video_url,
      }));

    return NextResponse.json({ avatars: studioAvatars });
  }

  // No baseId — return empty (never expose the full 1,283-avatar list)
  return NextResponse.json({ avatars: [] });
}
