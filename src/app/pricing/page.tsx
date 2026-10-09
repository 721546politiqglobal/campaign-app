import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCampaign, getBillingPlans } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { can } from '@/lib/permissions';
import { getTheme } from '@/lib/theme';
import { logoutAction } from '@/app/actions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertIcon, InfoIcon, LogoutIcon } from '@/components/icons';
import { PricingPlans, type PlanView, type PricingMode } from './PricingPlans';
import { CheckoutStatus } from './CheckoutStatus';

export default async function PricingPage({
  searchParams,
}: {
  searchParams: { checkout?: string };
}) {
  const [t, tBilling, tc, format] = await Promise.all([
    getTranslations('pricing'), getTranslations('billing'), getTranslations('common'), getFormatter(),
  ]);
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const profile = await getCandidateProfile(s.campaignId);
  if (!profile) redirect('/setup');

  const [campaign, plans] = await Promise.all([getCampaign(s.campaignId), getBillingPlans()]);
  const hasPlan = !!campaign?.planId;
  const canManage = can(s.role, 'edit_settings');
  const mode: PricingMode = !canManage ? 'readonly' : hasPlan ? 'switch' : 'subscribe';

  const money = (cents: number) => format.number(cents / 100, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
  // Each limit is one ICU message (plural-aware) — never "1 videos" / "0 team members".
  const feature = (key: 'teamMembers' | 'avatars' | 'contentPieces' | 'videosPerDay', n: number | null) =>
    (n === null ? t(`features.${key}Unlimited`) : t(`features.${key}`, { count: n }));

  const views: PlanView[] = plans.map(plan => ({
    id: plan.id,
    name: plan.name,
    price: money(plan.monthlyPriceCents),
    interval: plan.billingInterval === 'week' ? tBilling('perWeek') : tBilling('perMonth'),
    features: [
      feature('teamMembers', plan.seatLimit),
      feature('avatars', plan.avatarLimit),
      feature('contentPieces', plan.contentLimitMonthly),
      feature('videosPerDay', plan.videoLimitDaily),
    ],
    isCurrent: campaign?.planId === plan.id,
  }));

  const signOut = (
    <form action={logoutAction}>
      <SubmitButton variant="ghost" size="sm" pendingText={tc('signingOut')}>
        <LogoutIcon size={14} />
        {tc('signOut')}
      </SubmitButton>
    </form>
  );

  return (
    <div className="onboarding-wrap">
      <div className="onboarding onboarding-wide">
        <div className="onboarding-bar">
          <Logo className="onboarding-logo" />
          <div className="preauth-controls">
            <ThemeToggle current={getTheme()} size="sm" />
            {/* /pricing renders outside AppFrame (no sidebar), so without a plan
                there is nowhere else to go — sign out is the only exit. */}
            {signOut}
          </div>
        </div>

        {!hasPlan && (
          <ol className="stepper onboarding-stepper" aria-label={t('stepsLabel')}>
            <li className="step done">
              <span className="marker" aria-hidden="true">1</span>
              {t('steps.profile')}
            </li>
            <li className="connector done" aria-hidden="true" />
            <li className="step active" aria-current="step">
              <span className="marker" aria-hidden="true">2</span>
              {t('steps.plan')}
            </li>
          </ol>
        )}

        <PageHeader
          eyebrow={hasPlan ? t('changePlanEyebrow') : t('choosePlanEyebrow')}
          title={hasPlan ? t('changePlanTitle') : t('subscribeTitle')}
          description={t('description')}
          actions={hasPlan ? <Link href="/dashboard" className="btn">{t('goToDashboard')}</Link> : undefined}
        />

        <div className="stack">
          {searchParams.checkout === 'success' && <CheckoutStatus active={hasPlan} />}

          {searchParams.checkout === 'canceled' && !hasPlan && (
            <div className="alert alert-info" role="status">
              <InfoIcon className="icon" size={16} />
              <div className="alert-body">
                <div className="alert-title">{t('checkoutCanceled.title')}</div>
                <div className="alert-text">{t('checkoutCanceled.body')}</div>
              </div>
            </div>
          )}

          {!canManage && (
            <div className="alert alert-warn" role="status">
              <AlertIcon className="icon" size={16} />
              <div className="alert-body">
                <div className="alert-title">{t('notAllowed.title')}</div>
                <div className="alert-text">{t('notAllowed.body')}</div>
                {!hasPlan && <div className="alert-actions">{signOut}</div>}
              </div>
            </div>
          )}

          {views.length === 0 ? (
            <EmptyState icon="billing" title={t('noPlans.title')} description={t('noPlans.body')} />
          ) : (
            <PricingPlans plans={views} mode={mode} />
          )}
        </div>
      </div>
    </div>
  );
}
