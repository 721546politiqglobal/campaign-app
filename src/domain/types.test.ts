import { describe, it, expect } from 'vitest';
import { CONTENT_TYPES, isContentType, platformsMissingRequiredMedia } from './types';

describe('content type guard', () => {
  it('lists exactly the five known types', () => {
    expect([...CONTENT_TYPES].sort()).toEqual(
      ['ad_copy', 'press_release', 'reel', 'social_post', 'talking_points'].sort(),
    );
  });
  it('accepts a known type', () => {
    expect(isContentType('social_post')).toBe(true);
  });
  it('rejects an unknown type', () => {
    expect(isContentType('malicious_kind')).toBe(false);
    expect(isContentType('')).toBe(false);
  });
});

describe('platformsMissingRequiredMedia', () => {
  // Instagram and TikTok reject a post with no image/video attached (verified
  // live: HTTP 400 from Ayrshare) — social_post/ad_copy content items never
  // have a mediaUrl (only reels generate video), so selecting either platform
  // for that content is guaranteed to fail at publish time.
  it('flags instagram and tiktok when there is no media', () => {
    expect(platformsMissingRequiredMedia(['instagram', 'facebook', 'tiktok', 'x'], false))
      .toEqual(['instagram', 'tiktok']);
  });
  it('flags nothing once media is attached', () => {
    expect(platformsMissingRequiredMedia(['instagram', 'tiktok'], true)).toEqual([]);
  });
  it('flags nothing for platforms that support text-only posts', () => {
    expect(platformsMissingRequiredMedia(['facebook', 'x', 'linkedin'], false)).toEqual([]);
  });
});
