import type { Platform } from './types';

// One connected social account, as shown on /channels and used to gate
// publishing. Snapshot of Ayrshare's GET /user `displayNames[]`.
export type SocialAccount = {
  platform: Platform;
  name: string;
  handle: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  // LinkedIn/TikTok tokens expire; Ayrshare flags them before they do.
  refreshRequired: boolean;
};

export const SOCIAL_PLATFORMS: readonly Platform[] =
  ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'] as const;

export function isSocialPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

// An account that needs reconnecting can't post, so it counts as unconnected.
export function unconnectedPlatforms(requested: Platform[], connected: SocialAccount[]): Platform[] {
  const usable = new Set(connected.filter(a => !a.refreshRequired).map(a => a.platform));
  return requested.filter(p => !usable.has(p));
}

// Platforms usable now that weren't before. Accounts needing reconnection count
// as unconnected on both sides, so a successful reconnect reads as a new link.
export function newlyConnected(before: SocialAccount[], after: SocialAccount[]): Platform[] {
  const usable = (list: SocialAccount[]) => new Set(list.filter(a => !a.refreshRequired).map(a => a.platform));
  const had = usable(before);
  return [...usable(after)].filter(p => !had.has(p));
}
