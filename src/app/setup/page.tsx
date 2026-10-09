import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { getTheme } from '@/lib/theme';
import { logoutAction } from '@/app/actions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutIcon } from '@/components/icons';
import { SetupForm } from './SetupForm';

export default async function SetupPage() {
  const [t, tc] = await Promise.all([getTranslations('setup'), getTranslations('common')]);
  const s = await requireSession();
  const existing = await getCandidateProfile(s.campaignId);
  if (existing) redirect('/dashboard');

  return (
    <div className="onboarding-wrap">
      <div className="onboarding">
        <div className="onboarding-bar">
          <Logo className="onboarding-logo" />
          <div className="preauth-controls">
            <ThemeToggle current={getTheme()} size="sm" />
            <form action={logoutAction}>
              <SubmitButton variant="ghost" size="sm" pendingText={tc('signingOut')}>
                <LogoutIcon size={14} />
                {tc('signOut')}
              </SubmitButton>
            </form>
          </div>
        </div>

        <ol className="stepper onboarding-stepper" aria-label={t('stepsLabel')}>
          <li className="step active" aria-current="step">
            <span className="marker" aria-hidden="true">1</span>
            {t('steps.profile')}
          </li>
          <li className="connector" aria-hidden="true" />
          <li className="step">
            <span className="marker" aria-hidden="true">2</span>
            {t('steps.plan')}
          </li>
        </ol>

        <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

        <SetupForm />
      </div>
    </div>
  );
}
