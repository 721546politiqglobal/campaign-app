/** How long an invite link stays redeemable — shared by the admin console and the team page. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteExpiresAt(now = Date.now()): string {
  return new Date(now + INVITE_TTL_MS).toISOString();
}
