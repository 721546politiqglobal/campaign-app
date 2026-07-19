import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getBillingPlan, getMonthlySpend } from '@/lib/data';
import { openMyBillingPortalAction } from '@/app/actions';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/formatDate';
import { INACTIVE_STATUSES } from '@/domain/billing';

const STATUS_TONE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active:              { label: 'Active',    color: 'var(--ok)',     bg: 'var(--ok-dim)',     border: 'var(--ok-border)' },
  trialing:            { label: 'Trial',     color: 'var(--info)',   bg: 'var(--info-dim)',   border: 'var(--info-border)' },
  incomplete:          { label: 'Incomplete',color: 'var(--warn)',   bg: 'var(--warn-dim)',   border: 'var(--warn-border)' },
  past_due:            { label: 'Past due',  color: 'var(--warn)',   bg: 'var(--warn-dim)',   border: 'var(--warn-border)' },
  canceled:            { label: 'Canceled',  color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  unpaid:              { label: 'Unpaid',    color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  incomplete_expired:  { label: 'Expired',   color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  paused:              { label: 'Paused',    color: 'var(--text-2)', bg: 'rgba(120,110,98,0.14)', border: 'rgba(255,255,255,0.08)' },
};

const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default async function Billing() {
  const s = await requireSession();
  const campaign = await getCampaign(s.campaignId);
  const [plan, monthlySpendCents] = await Promise.all([
    campaign?.planId ? getBillingPlan(campaign.planId) : Promise.resolve(null),
    getMonthlySpend(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');

  const status = campaign?.subscriptionStatus ?? null;
  const tone = status ? STATUS_TONE[status] : null;
  const included = plan?.includedUsageCents ?? 0;
  const usedPct = included > 0 ? Math.min((monthlySpendCents / included) * 100, 100) : 0;
  const over = included > 0 && monthlySpendCents > included;
  const meterColor = over ? 'var(--warn)' : usedPct > 80 ? 'var(--warn)' : 'var(--accent)';

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Billing</h1></div>
      </div>

      {status === 'past_due' && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <div>
            <div className="t">Payment past due</div>
            <div className="b">
              {campaign?.gracePeriodEndsAt
                ? `Update your payment method by ${formatDate(campaign.gracePeriodEndsAt, 'date')} to avoid losing access to AI drafting, video, and voice generation.`
                : 'Update your payment method to avoid losing access.'}
            </div>
          </div>
        </div>
      )}
      {status && INACTIVE_STATUSES.has(status) && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <div>
            <div className="t">Billing inactive</div>
            <div className="b">AI drafting, video, and voice generation are blocked until this is resolved. Contact your platform admin.</div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Plan header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '22px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{plan ? plan.name : 'No plan'}</span>
              {tone && (
                <span className="mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 999, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}>{tone.label}</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {plan ? <>Campaign subscription · <span className="data" style={{ color: 'var(--text)' }}>{usd(plan.monthlyPriceCents)}</span>/mo</> : 'No plan assigned yet — contact your platform admin.'}
            </div>
          </div>
          {canEdit && campaign?.stripeCustomerId && (
            <form action={openMyBillingPortalAction}>
              <button className="btn primary" type="submit">Manage billing</button>
            </form>
          )}
        </div>

        {/* Usage meter */}
        {plan && (
          <div style={{ padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="eyebrow">Usage this billing period</span>
              <span className="data" style={{ fontSize: 13, color: over ? 'var(--warn)' : 'var(--text-3)' }}>
                {included > 0 ? `${Math.round((monthlySpendCents / included) * 100)}%` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
              <span className="data" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>{usd(monthlySpendCents)}</span>
              <span className="muted" style={{ fontSize: 13 }}>used of <span className="data" style={{ color: 'var(--text-2)' }}>{usd(included)}</span> included</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usedPct}%`, borderRadius: 999, background: usedPct > 80 || over ? meterColor : 'var(--accent-grad)', transition: 'width 0.4s ease' }} />
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              {over
                ? 'You’re over the included allowance — additional usage bills as overage.'
                : 'Usage above the included allowance bills as overage. Your hard spend cap is set separately in Settings.'}
            </p>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
