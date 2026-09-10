import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCampaign, getBillingPlans } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { startCheckoutAction, changePlanAction } from './actions';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: { checkout?: string; error?: string };
}) {
  const t = await getTranslations('pricing');
  const tBilling = await getTranslations('billing');
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const profile = await getCandidateProfile(s.campaignId);
  if (!profile) redirect('/setup');

  const [campaign, plans] = await Promise.all([getCampaign(s.campaignId), getBillingPlans()]);

  // Computed as a plain string (not passed via the `t` function itself) so the
  // inline 'use server' action below closes over a serializable value.
  const failedToChangePlanFallback = t('failedToChangePlanError');

  async function switchPlan(planId: string) {
    'use server';
    const result = await changePlanAction(planId);
    if (!result.ok) {
      redirect(`/pricing?error=${encodeURIComponent(result.error ?? failedToChangePlanFallback)}`);
    }
    redirect('/billing');
  }

  return (
    <div className="setup-wrap">
      <div style={{ width: '100%', maxWidth: 960 }}>
        <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span className="eyebrow">{campaign?.planId ? t('changePlanEyebrow') : t('choosePlanEyebrow')}</span>
            <h1 style={{ margin: '6px 0 8px' }}>{campaign?.planId ? t('changePlanTitle') : t('subscribeTitle')}</h1>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              {t('description')}
            </p>
          </div>
          {/* /pricing renders outside AppFrame (no sidebar nav) so it isn't
              wrapped in the race-with-the-webhook problem I3 fixes for
              success_url — but that leaves nothing to click back into the
              app with once a plan is active. Only show this once a plan
              exists; with no plan, AppFrame itself redirects back here. */}
          {campaign?.planId && (
            <Link href="/dashboard" className="btn" style={{ flexShrink: 0 }}>{t('goToDashboard')}</Link>
          )}
        </div>

        {searchParams.checkout === 'success' && (
          <div className="banner ok" style={{ marginBottom: 20 }}>
            <div>
              <div className="t">{t('paymentReceivedTitle')}</div>
              <div className="b">{t('paymentReceivedBody')}</div>
            </div>
          </div>
        )}
        {searchParams.error && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div><div className="t">{t('couldntChangePlanTitle')}</div><div className="b">{searchParams.error}</div></div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
          {plans.map(plan => {
            const isCurrent = campaign?.planId === plan.id;
            return (
              <div key={plan.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{plan.name}</div>
                  <div className="data" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
                    {fmt(plan.monthlyPriceCents)}
                    <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/{plan.billingInterval === 'week' ? tBilling('perWeek') : tBilling('perMonth')}</span>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <li>{plan.seatLimit ?? tBilling('unlimited')} {t('teamMembersLabel')}</li>
                  <li>{plan.avatarLimit ?? tBilling('unlimited')} {t('avatarsLabel')}</li>
                  <li>{plan.contentLimitMonthly ?? tBilling('unlimited')} {t('contentPiecesLabel')}</li>
                  <li>{plan.videoLimitDaily ?? tBilling('unlimited')} {t('videosPerDayLabel')}</li>
                </ul>
                {isCurrent ? (
                  <button className="btn" disabled style={{ marginTop: 'auto' }}>{t('currentPlanButton')}</button>
                ) : campaign?.planId ? (
                  <form action={switchPlan.bind(null, plan.id)} style={{ marginTop: 'auto' }}>
                    <button className="btn primary" type="submit" style={{ width: '100%' }}>{t('switchPlanButton')}</button>
                  </form>
                ) : (
                  <form action={startCheckoutAction.bind(null, plan.id)} style={{ marginTop: 'auto' }}>
                    <button className="btn primary" type="submit" style={{ width: '100%' }}>{t('subscribeButton')}</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
