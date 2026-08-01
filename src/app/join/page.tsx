import Link from 'next/link';
import { joinAction } from '@/app/actions';
import { adminDb } from '@/lib/supabase';

const ERROR_MSG: Record<string, string> = {
  fields:   'All fields are required.',
  password: 'Password must be at least 8 characters.',
  invalid:  'This invite link is not valid.',
  used:     'This invite link has already been used.',
  expired:  'This invite link has expired. Ask for a new one.',
  email:    'An account with that email already exists.',
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string };
}) {
  const code = searchParams.code ?? '';
  const errorMsg = searchParams.error ? (ERROR_MSG[searchParams.error] ?? 'Something went wrong.') : null;

  // Fetch invite to show context (campaign name, role)
  let inviteContext: { campaignName: string; role: string } | null = null;
  if (code) {
    const { data: inv } = await adminDb
      .from('invite_codes')
      .select('role, campaign_id, used_at, expires_at')
      .eq('code', code)
      .single();
    if (inv && !inv.used_at && new Date(inv.expires_at) > new Date()) {
      const { data: camp } = await adminDb
        .from('campaigns')
        .select('name')
        .eq('id', inv.campaign_id)
        .single();
      inviteContext = { campaignName: camp?.name ?? '', role: inv.role };
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Link href="/" className="login-logo">
          <img src="/politiq-logo.png" alt="PolitIQ" className="login-logo-img" />
        </Link>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            fontSize: 20, fontWeight: 800, letterSpacing: '-0.025em',
            color: 'var(--text)', margin: '0 0 6px', textTransform: 'none',
          }}>
            Join your campaign
          </h2>
          {inviteContext ? (
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              You&apos;ve been invited to{' '}
              <strong style={{ color: 'var(--text)' }}>{inviteContext.campaignName}</strong>
              {' '}as <strong style={{ color: 'var(--accent)' }}>{inviteContext.role}</strong>.
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              Create your account using an invite link.
            </p>
          )}
        </div>

        <div className="login-divider" />

        {/* Show invalid/expired state without a form */}
        {code && !inviteContext && !searchParams.error ? (
          <div style={{
            fontSize: 13.5, color: 'var(--bad)', background: 'var(--bad-dim)',
            border: '1px solid var(--bad-border)', borderRadius: 'var(--r)',
            padding: '12px 14px', lineHeight: 1.5,
          }}>
            This invite link is invalid or has already been used.
          </div>
        ) : (
          <form action={joinAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="field">
              <span className="cap">Invite code</span>
              <input
                name="code"
                required
                defaultValue={code}
                placeholder="inv_xxxxxxxxxxxx"
                style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.02em' }}
              />
            </label>

            <label className="field">
              <span className="cap">Full name</span>
              <input
                name="name"
                required
                autoComplete="name"
                placeholder="Alex Rivera"
              />
            </label>

            <label className="field">
              <span className="cap">Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@campaign.com"
              />
            </label>

            <label className="field">
              <span className="cap">Password</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </label>

            {errorMsg && (
              <div style={{
                fontSize: 13, color: 'var(--bad)', background: 'var(--bad-dim)',
                border: '1px solid var(--bad-border)', borderRadius: 'var(--r)',
                padding: '9px 12px', fontWeight: 500,
              }}>
                {errorMsg}
              </div>
            )}

            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              Create account
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/login" style={{ fontSize: 13, color: 'var(--text-3)' }}>
            Already have an account?{' '}
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in →</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
