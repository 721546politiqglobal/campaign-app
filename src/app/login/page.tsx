import Link from 'next/link';
import { adminDb } from '@/lib/supabase';
import { loginAction } from '@/app/actions';

export default async function LoginPage() {
  const { data: users } = await adminDb.from('users').select('id, name, role').limit(10);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Link href="/" className="login-logo" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, textDecoration: 'none' }}>
          <div className="login-logo-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M3 9L9 3L15 9L9 15L3 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <circle cx="9" cy="9" r="2.5" fill="currentColor"/>
            </svg>
          </div>
          <span className="login-title">Command Center</span>
        </Link>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text)', margin: '0 0 6px', textTransform: 'none' }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            Sign in to your campaign workspace.
          </p>
        </div>

        <div className="login-divider" />

        {users && users.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {users.map((user) => (
              <form key={user.id} action={loginAction}>
                <input type="hidden" name="userId" value={user.id} />
                <button
                  className="btn login-user-btn"
                  type="submit"
                >
                  <div className="login-user-avatar">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13.5 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{user.role}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                    <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--bad)', fontSize: 13 }}>
            No users found. Run the database migration first.
          </p>
        )}

        <div className="login-meta" style={{ marginTop: 24 }}>
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
