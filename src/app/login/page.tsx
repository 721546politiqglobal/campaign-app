import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getLocale } from '@/lib/locale';
import { getTheme } from '@/lib/theme';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const t = await getTranslations('login');

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
          <h1 className="auth-title">{t('welcomeBack')}</h1>
          <p className="auth-sub">{t('subtitle')}</p>
        </div>

        <LoginForm />

        <p className="auth-alt">
          {t('haveInviteCode')}{' '}
          <Link href="/join" className="link">{t('joinCampaignLink')}</Link>
        </p>

        <div className="auth-meta">
          <span>{t('secure')}</span>
          <span aria-hidden="true">·</span>
          <span>{t('aiDisclosed')}</span>
          <span aria-hidden="true">·</span>
          <span>{t('audited')}</span>
        </div>
      </div>
    </div>
  );
}
