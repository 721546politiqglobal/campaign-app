import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Role } from '@/domain/types';

export interface Session {
  userId: string;
  name: string;
  role: Role;
  campaignId: string | null;   // null for super_admin (no tenant)
  exp: number;
}

const COOKIE = 'cc_session';
const WEEK_S = 7 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // The fallback below is checked into source control, so anyone who can read
  // this repo can forge a session (including a super_admin one) if it's ever
  // used outside local dev. Refuse to sign/verify sessions in production
  // rather than silently running with a known secret.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is not set. Refusing to start session handling in production without it.');
  }
  return 'dev-only-secret-change-in-production';
}

function makeToken(data: Session): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function parseToken(token: string): Session | null {
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function setSessionCookie(session: Session): void {
  cookies().set(COOKIE, makeToken(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: WEEK_S,
    secure: process.env.NODE_ENV === 'production',
  });
}

// Re-checks the user against the DB on every call rather than trusting
// role/campaignId baked into the (up to 7-day-old) signed cookie — otherwise a
// removed or demoted user keeps their old access for the rest of the cookie's
// life, since sessions are otherwise stateless.
export async function getSession(): Promise<Session | null> {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const token = parseToken(raw);
  if (!token) return null;

  const { adminDb } = await import('./supabase');
  const { data: user } = await adminDb
    .from('users')
    .select('id, name, role, campaign_id')
    .eq('id', token.userId)
    .maybeSingle();
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name,
    role: user.role as Role,
    campaignId: user.campaign_id,
    exp: token.exp,
  };
}

// Tenant contexts (all non-admin pages and server actions) require a campaign.
// super_admin carries campaignId === null, so send them to the admin console
// rather than letting a null tenant id flow into campaign-scoped queries
// (audit finding DATA-18). The narrowed return type frees every tenant call
// site from re-checking for null.
export async function requireSession(): Promise<Session & { campaignId: string }> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.campaignId === null) redirect('/admin');
  return s as Session & { campaignId: string };
}

export async function requireAdmin(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  // A valid session that simply lacks admin rights is NOT a logout — send them
  // back to their own dashboard rather than the login screen (FLOW-1).
  if (s.role !== 'super_admin') redirect('/dashboard');
  return s;
}

export async function signInAs(userId: string): Promise<void> {
  const { adminDb } = await import('./supabase');
  const { data: user } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (!user) return;
  setSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role as Role,
    campaignId: user.campaign_id,
    exp: Math.floor(Date.now() / 1000) + WEEK_S,
  });
}

export function signOut(): void {
  cookies().delete(COOKIE);
}
