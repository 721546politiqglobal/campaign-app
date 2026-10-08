import { describe, it, expect } from 'vitest';
import { unconnectedPlatforms, newlyConnected, isSocialPlatform, type SocialAccount } from './channels';

const acct = (platform: SocialAccount['platform'], over: Partial<SocialAccount> = {}): SocialAccount => ({
  platform, name: platform, handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false, ...over,
});

describe('unconnectedPlatforms', () => {
  it('returns requested platforms the campaign has not connected, in request order', () => {
    expect(unconnectedPlatforms(['tiktok', 'instagram', 'x'], [acct('instagram')])).toEqual(['tiktok', 'x']);
  });
  it('treats an account that needs reconnecting as not connected', () => {
    expect(unconnectedPlatforms(['linkedin'], [acct('linkedin', { refreshRequired: true })])).toEqual(['linkedin']);
  });
  it('returns [] when everything requested is connected', () => {
    expect(unconnectedPlatforms(['x'], [acct('x')])).toEqual([]);
  });
});

describe('newlyConnected', () => {
  it('lists platforms present after but not before', () => {
    expect(newlyConnected([acct('x')], [acct('x'), acct('youtube')])).toEqual(['youtube']);
  });
  // A reconnect (refreshRequired → usable) is a fresh link from the user's
  // point of view and deserves the "connected" toast.
  it('counts a reconnect (refreshRequired before, usable after) as newly connected', () => {
    expect(newlyConnected([acct('linkedin', { refreshRequired: true })], [acct('linkedin')])).toEqual(['linkedin']);
  });
  it('does not count an account that still needs reconnecting', () => {
    expect(newlyConnected([], [acct('tiktok', { refreshRequired: true })])).toEqual([]);
  });
});

describe('isSocialPlatform', () => {
  it('accepts the six supported platforms and rejects anything else', () => {
    expect(isSocialPlatform('instagram')).toBe(true);
    expect(isSocialPlatform('twitter')).toBe(false);
    expect(isSocialPlatform('pinterest')).toBe(false);
    expect(isSocialPlatform(undefined)).toBe(false);
  });
});
