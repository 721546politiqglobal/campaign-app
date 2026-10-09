import { timingSafeEqual } from 'node:crypto';

// Constant-time check of the cron bearer token. A plain `===` short-circuits
// on the first mismatching byte, which leaks how much of the secret matched.
// Fails closed when CRON_SECRET is unset (so "Bearer undefined" never passes).
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(authorization, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
