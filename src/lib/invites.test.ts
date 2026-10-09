import { describe, it, expect } from 'vitest';
import { INVITE_TTL_MS, inviteExpiresAt } from './invites';

describe('invites', () => {
  it('TTL is seven days', () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('inviteExpiresAt adds the TTL to the given time', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(inviteExpiresAt(now)).toBe(new Date(now + INVITE_TTL_MS).toISOString());
  });

  it('defaults to now', () => {
    const before = Date.now();
    const t = new Date(inviteExpiresAt()).getTime();
    expect(t).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(t).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
  });
});
