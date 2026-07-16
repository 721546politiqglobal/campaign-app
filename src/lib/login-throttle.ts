import { adminDb } from './supabase';

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface AttemptRow { attempts: number; windowStart: number; lockedUntil: number | null; }

export function isLockedOut(row: AttemptRow | null, now: number): boolean {
  return !!row && row.lockedUntil !== null && row.lockedUntil > now;
}

// State after ONE failed attempt. Reset the window if it has closed; set the
// lockout once we hit the threshold within a single window.
export function nextFailureState(row: AttemptRow | null, now: number): AttemptRow {
  if (!row || now - row.windowStart > WINDOW_MS) {
    return { attempts: 1, windowStart: now, lockedUntil: null };
  }
  const attempts = row.attempts + 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? now + LOCKOUT_MS : row.lockedUntil;
  return { attempts, windowStart: row.windowStart, lockedUntil };
}

function toRow(r: Record<string, unknown> | null): AttemptRow | null {
  if (!r) return null;
  return {
    attempts: r.attempts as number,
    windowStart: new Date(r.window_start as string).getTime(),
    lockedUntil: r.locked_until ? new Date(r.locked_until as string).getTime() : null,
  };
}

export async function getAttempts(key: string): Promise<AttemptRow | null> {
  const { data } = await adminDb.from('login_attempts').select('*').eq('key', key).maybeSingle();
  return toRow(data as Record<string, unknown> | null);
}

export async function recordFailure(key: string, now: number): Promise<void> {
  const current = await getAttempts(key);
  const next = nextFailureState(current, now);
  await adminDb.from('login_attempts').upsert({
    key,
    attempts: next.attempts,
    window_start: new Date(next.windowStart).toISOString(),
    locked_until: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null,
  });
}

export async function clearAttempts(key: string): Promise<void> {
  await adminDb.from('login_attempts').delete().eq('key', key);
}
