import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Role } from '@/domain/types';

export interface Session {
  userId: string;
  name: string;
  role: Role;
  campaignId: string;
  exp: number;
}

const COOKIE = 'cc_session';
const WEEK_S = 7 * 24 * 60 * 60;

function secret(): string {
  return process.env.SESSION_SECRET ?? 'dev-only-secret-change-in-production';
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

export function getSession(): Session | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  return parseToken(raw);
}

export function requireSession(): Session {
  const s = getSession();
  if (!s) redirect('/login');
  return s;
}

export function requireAdmin(): Session {
  const s = getSession();
  if (!s || s.role !== 'super_admin') redirect('/login');
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
