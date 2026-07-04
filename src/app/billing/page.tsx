import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getBillingPlan, getMonthlySpend } from '@/lib/data';
import { openMyBillingPortalAction } from '@/app/actions';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/formatDate';

export default async function Billing() {
  const s = requireSession();
  const campaign = await getCampaign(s.campaignId);
  const [plan, monthlySpendCents] = await Promise.all([
    campaign?.planId ? getBillingPlan(campaign.planId) : Promise.resolve(null),
    getMonthlySpend(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Billing</h1></div>
      </div>

      <div className="card">
        <h2>Subscription</h2>
        {campaign?.subscriptionStatus === 'past_due' && (
          <div className="banner warn" style={{ margin: '12px 0' }}>
            <div>
              <div className="t">Payment past due</div>
              <div className="b">
                {campaign.gracePeriodEndsAt
                  ? `Update your payment method by ${formatDate(campaign.gracePeriodEndsAt, 'date')} to avoid losing access to AI drafting, video, and voice generation.`
                  : 'Update your payment method to avoid losing access.'}
              </div>
            </div>
          </div>
        )}
        {(campaign?.subscriptionStatus === 'canceled' || campaign?.subscriptionStatus === 'unpaid') && (
          <div className="banner warn" style={{ margin: '12px 0' }}>
            <div>
              <div className="t">Billing inactive</div>
              <div className="b">AI drafting, video, and voice generation are blocked until this is resolved. Contact your platform admin.</div>
            </div>
          </div>
        )}
        {plan ? (
          <>
            <p style={{ fontSize: 14, marginTop: 8 }}>
              <strong>{plan.name}</strong> — {(plan.monthlyPriceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
            </p>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {(monthlySpendCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} used of{' '}
              {(plan.includedUsageCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} included this month
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>No plan assigned yet — contact your platform admin.</p>
        )}
        {canEdit && campaign?.stripeCustomerId && (
          <form action={openMyBillingPortalAction} style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit">Manage billing</button>
          </form>
        )}
      </div>
    </AppFrame>
  );
}
