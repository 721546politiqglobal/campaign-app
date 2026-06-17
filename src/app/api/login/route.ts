import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const userId = String(formData.get('userId') ?? '');

  const { data: user } = await adminDb
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  const dest = user?.role === 'super_admin' ? '/admin' : '/dashboard';
  const res = NextResponse.redirect(new URL(dest, req.url));

  if (user) {
    res.cookies.set('session', JSON.stringify({
      userId: user.id,
      name: user.name,
      role: user.role,
      campaignId: user.campaign_id,
    }), { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  return res;
}
