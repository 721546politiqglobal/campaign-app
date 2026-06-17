import { NextRequest, NextResponse } from 'next/server';

// Dev-only: set a super_admin session to preview the admin panel.
// Remove this route before production deployment.
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }
  const res = NextResponse.redirect(new URL('/admin', req.url));
  res.cookies.set('session', JSON.stringify({
    userId: 'u-admin', name: 'Super Admin', role: 'super_admin', campaignId: null,
  }), { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
}
