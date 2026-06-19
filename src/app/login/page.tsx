import Link from 'next/link';
import { loginAction } from '@/app/actions';

const ERROR_MSG: Record<string, string> = {
  '1': 'Incorrect email or password.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const errorMsg = searchParams.error ? (ERROR_MSG[searchParams.error] ?? 'Something went wrong.') : null;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Link href="/" className="login-logo">
          <div className="login-logo-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 9L9 3L15 9L9 15L3 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <circle cx="9" cy="9" r="2.5" fill="currentColor"/>
            </svg>
          </div>
          <span className="login-title">Command Center</span>
        </Link>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            fontSize: 20, fontWeight: 800, letterSpacing: '-0.025em',
            color: 'var(--text)', margin: '0 0 6px', textTransform: 'none',
          }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            Sign in to your campaign workspace.
          </p>
        </div>

        <div className="login-divider" />

        <form action={loginAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              autoComplete="current-password"
              placeholder="••••••••"
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
            Sign in
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/join" style={{ fontSize: 13, color: 'var(--text-3)' }}>
            Have an invite code?{' '}
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Join your campaign →</span>
          </Link>
        </div>

        <div className="login-meta" style={{ marginTop: 20 }}>
          <span>Secure</span>
          <span>·</span>
          <span>AI-Disclosed</span>
          <span>·</span>
          <span>Audited</span>
        </div>
      </div>
    </div>
  );
}
