import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { joinAction } from '@/app/actions';
import { adminDb } from '@/lib/supabase';
import { getLocale } from '@/lib/locale';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string };
}) {
  const t = await getTranslations('join');
  const ERROR_MSG: Record<string, string> = {
    fields:   t('errors.allFieldsRequired'),
    password: t('errors.passwordTooShort'),
    invalid:  t('errors.inviteInvalid'),
    used:     t('errors.inviteUsed'),
    expired:  t('errors.inviteExpired'),
    email:    t('errors.emailExists'),
  };

  const code = searchParams.code ?? '';
  const errorMsg = searchParams.error ? (ERROR_MSG[searchParams.error] ?? t('errors.somethingWentWrong')) : null;

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
            {t('heading')}
          </h2>
          {inviteContext ? (
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              {t.rich('invitedTo', {
                campaignName: inviteContext.campaignName,
                role: inviteContext.role,
                name: (chunks) => <strong style={{ color: 'var(--text)' }}>{chunks}</strong>,
                roleTag: (chunks) => <strong style={{ color: 'var(--accent)' }}>{chunks}</strong>,
              })}
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              {t('createAccountIntro')}
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
            {t('invalidOrUsedNotice')}
          </div>
        ) : (
          <form action={joinAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="field">
              <span className="cap">{t('inviteCodeLabel')}</span>
              <input
                name="code"
                required
                defaultValue={code}
                placeholder={t('inviteCodePlaceholder')}
                style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.02em' }}
              />
            </label>

            <label className="field">
              <span className="cap">{t('fullNameLabel')}</span>
              <input
                name="name"
                required
                autoComplete="name"
                placeholder={t('fullNamePlaceholder')}
              />
            </label>

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
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder')}
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
              {t('createAccountButton')}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/login" style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {t('alreadyHaveAccount')}{' '}
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('signInLink')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
