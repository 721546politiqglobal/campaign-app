import { redirect } from 'next/navigation';
import { getBillingPlans } from '@/lib/data';
import { syncBillingPlansAction, upsertBillingPlanAction, deleteBillingPlanAction } from './actions';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';
import type { BillingPlan } from '@/lib/data';
import { SubmitButton } from '@/components/SubmitButton';

const CORE_PLAN_IDS = new Set(PLAN_DEFINITIONS.map(d => d.id));

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function intervalLabel(interval: 'week' | 'month') {
  return interval === 'week' ? '/wk' : '/mo';
}

function PlanForm({ plan }: { plan?: BillingPlan }) {
  const isNew = !plan;

  async function save(formData: FormData) {
    'use server';
    const result = await upsertBillingPlanAction(formData);
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Save failed.'));
    }
    redirect(`/admin/billing?saved=${isNew ? 'created' : 'updated'}`);
  }

  return (
    <form action={save} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="id" value={plan?.id ?? ''} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">Plan name</label>
          <input name="name" className="input" defaultValue={plan?.name ?? ''} required />
        </div>
        <div>
          <label className="field-label">Price (USD)</label>
          <input name="priceDollars" type="number" step="0.01" min="0" className="input"
            defaultValue={plan ? (plan.monthlyPriceCents / 100).toFixed(2) : ''} required />
        </div>
        <div>
          <label className="field-label">Billing interval</label>
          <select name="billingInterval" className="input" defaultValue={plan?.billingInterval ?? 'month'}>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">Member limit</label>
          <input name="seatLimit" type="number" min="0" className="input" defaultValue={plan?.seatLimit ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Avatar limit</label>
          <input name="avatarLimit" type="number" min="0" className="input" defaultValue={plan?.avatarLimit ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Content/period</label>
          <input name="contentLimitMonthly" type="number" min="0" className="input" defaultValue={plan?.contentLimitMonthly ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Videos/day</label>
          <input name="videoLimitDaily" type="number" min="0" className="input" defaultValue={plan?.videoLimitDaily ?? ''} placeholder="Unlimited" />
        </div>
      </div>
      <SubmitButton style={{ alignSelf: 'flex-start' }} pendingText={plan ? 'Saving…' : 'Creating…'}>
        {plan ? 'Save changes' : 'Create plan'}
      </SubmitButton>
    </form>
  );
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: { error?: string; saved?: string };
}) {
  const plans = await getBillingPlans();

  async function sync() {
    'use server';
    const result = await syncBillingPlansAction();
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Sync failed.'));
    }
    redirect('/admin/billing?saved=synced');
  }

  async function del(formData: FormData) {
    'use server';
    const result = await deleteBillingPlanAction(formData);
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Delete failed.'));
    }
    redirect('/admin/billing?saved=deleted');
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Billing plans</h1>
        </div>
      </div>

      {searchParams.error && (
        <div className="banner warn" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">Action failed</div>
            <div className="b">{searchParams.error}</div>
          </div>
        </div>
      )}

      {searchParams.saved && (
        <div className="banner ok" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">
              {searchParams.saved === 'created' && 'Plan created'}
              {searchParams.saved === 'updated' && 'Plan saved'}
              {searchParams.saved === 'synced' && 'Starter plans synced'}
              {searchParams.saved === 'deleted' && 'Plan deleted'}
            </div>
            <div className="b">
              {searchParams.saved === 'created' && 'The new plan is live in Stripe and ready to assign to a campaign.'}
              {searchParams.saved === 'updated' && 'Your changes are saved — price or interval changes are already reflected in Stripe.'}
              {searchParams.saved === 'synced' && 'Starter, Pro, and Enterprise are ready to edit or assign below.'}
              {searchParams.saved === 'deleted' && 'The plan is removed and its Stripe product/price archived.'}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Creates the three starter plans (Starter, Pro, Enterprise) in Stripe the first time you set
          this up. Safe to run more than once — plans that already exist are skipped. Use the forms
          below to edit prices, limits, or billing interval at any time; changes save straight to
          Stripe, so there&apos;s no separate sync step needed afterward.
        </p>
        <form action={sync}>
          <SubmitButton className="btn" pendingText="Syncing…">Sync starter plans to Stripe</SubmitButton>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {plans.map(p => (
          <div key={p.id}>
            <div className="eyebrow" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{p.name} · {fmt(p.monthlyPriceCents)}{intervalLabel(p.billingInterval)}</span>
              {!CORE_PLAN_IDS.has(p.id) && (
                <form action={del}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="btn" style={{ fontSize: 12 }} pendingText="Deleting…">Delete plan</SubmitButton>
                </form>
              )}
            </div>
            <PlanForm plan={p} />
          </div>
        ))}
        {plans.length === 0 && (
          <div className="card"><p className="muted">No plans yet — sync the starter plans above, or create one below.</p></div>
        )}
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>New plan</div>
        <PlanForm />
      </div>
    </div>
  );
}
