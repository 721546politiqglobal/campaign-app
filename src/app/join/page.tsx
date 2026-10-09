import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { adminDb } from '@/lib/supabase';
import { getLocale } from '@/lib/locale';
import { getTheme } from '@/lib/theme';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { AlertIcon } from '@/components/icons';
import { JoinForm } from './JoinForm';

const ROLE_KEYS = ['owner', 'manager', 'approver', 'staff', 'super_admin'] as const;

export default async function JoinPage({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  const [t, tc] = await Promise.all([getTranslations('join'), getTranslations('common')]);
  const code = searchParams.code ?? '';

  // Fetch the invite to show context (campaign name, role) above the form.
  let inviteContext: { campaignName: string; roleLabel: string } | null = null;
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
      const role = String(inv.role);
      const roleLabel = (ROLE_KEYS as readonly string[]).includes(role) ? tc(`roles.${role as (typeof ROLE_KEYS)[number]}`) : role;
      inviteContext = { campaignName: camp?.name ?? '', roleLabel };
    }
  }
  const inviteBroken = !!code && !inviteContext;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <Link href="/" className="auth-logo" aria-label="PolitIQ">
            <Logo className="auth-logo-img" />
          </Link>
          <div className="preauth-controls">
            <ThemeToggle current={getTheme()} size="sm" />
            <PreAuthLanguageToggle currentLocale={getLocale()} />
          </div>
        </div>

        <div className="auth-intro">
          <h1 className="auth-title">{t('heading')}</h1>
          <p className="auth-sub">
            {inviteContext
              ? t.rich('invitedTo', {
                  campaignName: inviteContext.campaignName,
                  role: inviteContext.roleLabel,
                  name: (chunks) => <strong className="auth-strong">{chunks}</strong>,
                  roleTag: (chunks) => <strong className="auth-accent">{chunks}</strong>,
                })
              : t('createAccountIntro')}
          </p>
        </div>

        {inviteBroken ? (
          <div className="alert alert-bad" role="alert">
            <AlertIcon className="icon" size={16} />
            <div className="alert-body">
              <div className="alert-title">{t('invalidOrUsedNotice')}</div>
              <div className="alert-text">{t('askForNewInvite')}</div>
            </div>
          </div>
        ) : (
          <JoinForm code={code} />
        )}

        <p className="auth-alt">
          {t('alreadyHaveAccount')}{' '}
          <Link href="/login" className="link">{t('signInLink')}</Link>
        </p>
      </div>
    </div>
  );
}
