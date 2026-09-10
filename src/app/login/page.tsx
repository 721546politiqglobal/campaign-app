import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loginAction } from '@/app/actions';
import { getLocale } from '@/lib/locale';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const t = await getTranslations('login');
  const ERROR_MSG: Record<string, string> = {
    '1': t('errors.incorrectCredentials'),
    locked: t('errors.tooManyAttempts'),
  };
  const errorMsg = searchParams.error ? (ERROR_MSG[searchParams.error] ?? t('errors.somethingWentWrong')) : null;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Link href="/" className="login-logo">
            <img src="/politiq-logo.png" alt="PolitIQ" className="login-logo-img" />
          </Link>
          <PreAuthLanguageToggle currentLocale={getLocale()} />
        </div>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            fontSize: 20, fontWeight: 800, letterSpacing: '-0.025em',
            color: 'var(--text)', margin: '0 0 6px', textTransform: 'none',
          }}>
            {t('welcomeBack')}
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            {t('subtitle')}
          </p>
        </div>

        <div className="login-divider" />

        <form action={loginAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">
            <span className="cap">{t('emailLabel')}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
            />
          </label>

          <label className="field">
            <span className="cap">{t('passwordLabel')}</span>
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
            {t('signInButton')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/join" style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {t('haveInviteCode')}{' '}
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('joinCampaignLink')}</span>
          </Link>
        </div>

        <div className="login-meta" style={{ marginTop: 20 }}>
          <span>{t('secure')}</span>
          <span>·</span>
          <span>{t('aiDisclosed')}</span>
          <span>·</span>
          <span>{t('audited')}</span>
        </div>
      </div>
    </div>
  );
}
