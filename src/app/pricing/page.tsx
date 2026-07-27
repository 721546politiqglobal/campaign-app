import { redirect } from 'next/navigation';
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
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const profile = await getCandidateProfile(s.campaignId);
  if (!profile) redirect('/setup');

  const [campaign, plans] = await Promise.all([getCampaign(s.campaignId), getBillingPlans()]);

  async function switchPlan(planId: string) {
    'use server';
    const result = await changePlanAction(planId);
    if (!result.ok) {
      redirect(`/pricing?error=${encodeURIComponent(result.error ?? 'Failed to change plan.')}`);
    }
    redirect('/billing');
  }

  return (
    <div className="setup-wrap">
      <div style={{ width: '100%', maxWidth: 960 }}>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">{campaign?.planId ? 'Change plan' : 'Choose a plan'}</span>
          <h1 style={{ margin: '6px 0 8px' }}>{campaign?.planId ? 'Change your plan' : 'Subscribe to get started'}</h1>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Every plan includes AI drafting, avatars, and video generation — the limits below are what changes between tiers.
          </p>
        </div>

        {searchParams.checkout === 'success' && (
          <div className="banner ok" style={{ marginBottom: 20 }}>
            <div>
              <div className="t">Payment received</div>
              <div className="b">Activating your plan — this can take a few seconds. Refresh if the app doesn&rsquo;t update.</div>
            </div>
          </div>
        )}
        {searchParams.error && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div><div className="t">Couldn&rsquo;t change plan</div><div className="b">{searchParams.error}</div></div>
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
                    {fmt(plan.monthlyPriceCents)}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/mo</span>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <li>{plan.seatLimit ?? 'Unlimited'} seats</li>
                  <li>{plan.avatarLimit ?? 'Unlimited'} avatars</li>
                  <li>{plan.contentLimitMonthly ?? 'Unlimited'} content pieces/mo</li>
                  <li>{plan.videoLimitDaily ?? 'Unlimited'} videos/day</li>
                </ul>
                {isCurrent ? (
                  <button className="btn" disabled style={{ marginTop: 'auto' }}>Current plan</button>
                ) : campaign?.planId ? (
                  <form action={switchPlan.bind(null, plan.id)} style={{ marginTop: 'auto' }}>
                    <button className="btn primary" type="submit" style={{ width: '100%' }}>Switch to this plan</button>
                  </form>
                ) : (
                  <form action={startCheckoutAction.bind(null, plan.id)} style={{ marginTop: 'auto' }}>
                    <button className="btn primary" type="submit" style={{ width: '100%' }}>Subscribe</button>
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
