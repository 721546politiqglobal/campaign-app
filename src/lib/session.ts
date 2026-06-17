import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminDb } from './supabase';
import { Role } from '@/domain/types';

export interface Session { userId: string; name: string; role: Role; campaignId: string; }

const COOKIE = 'session';

export function getSession(): Session | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { return null; }
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

export async function signInAs(userId: string) {
  const { data: user } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (!user) return;
  const session: Session = { userId: user.id, name: user.name, role: user.role, campaignId: user.campaign_id };
  cookies().set(COOKIE, JSON.stringify(session), { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function signOut() {
  cookies().delete(COOKIE);
}
