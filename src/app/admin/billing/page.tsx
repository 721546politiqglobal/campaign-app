import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getBillingPlans } from '@/lib/data';
import { syncBillingPlansAction, upsertBillingPlanAction, deleteBillingPlanAction } from './actions';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';
import type { BillingPlan } from '@/lib/data';
import { SubmitButton } from '@/components/SubmitButton';

const CORE_PLAN_IDS = new Set(PLAN_DEFINITIONS.map(d => d.id));

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function intervalLabel(interval: 'week' | 'month', t: (key: string) => string) {
  return interval === 'week' ? t('perWeekSuffix') : t('perMonthSuffix');
}

async function PlanForm({ plan }: { plan?: BillingPlan }) {
  const t = await getTranslations('admin.billing');
  const isNew = !plan;

  async function save(formData: FormData) {
    'use server';
    const result = await upsertBillingPlanAction(formData);
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? t('saveFailedError')));
    }
    redirect(`/admin/billing?saved=${isNew ? 'created' : 'updated'}`);
  }

  return (
    <form action={save} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="id" value={plan?.id ?? ''} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">{t('planNameLabel')}</label>
          <input name="name" className="input" defaultValue={plan?.name ?? ''} required />
        </div>
        <div>
          <label className="field-label">{t('priceLabel')}</label>
          <input name="priceDollars" type="number" step="0.01" min="0" className="input"
            defaultValue={plan ? (plan.monthlyPriceCents / 100).toFixed(2) : ''} required />
        </div>
        <div>
          <label className="field-label">{t('billingIntervalLabel')}</label>
          <select name="billingInterval" className="input" defaultValue={plan?.billingInterval ?? 'month'}>
            <option value="week">{t('weekly')}</option>
            <option value="month">{t('monthly')}</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">{t('memberLimitLabel')}</label>
          <input name="seatLimit" type="number" min="0" className="input" defaultValue={plan?.seatLimit ?? ''} placeholder={t('unlimitedPlaceholder')} />
        </div>
        <div>
          <label className="field-label">{t('avatarLimitLabel')}</label>
          <input name="avatarLimit" type="number" min="0" className="input" defaultValue={plan?.avatarLimit ?? ''} placeholder={t('unlimitedPlaceholder')} />
        </div>
        <div>
          <label className="field-label">{t('contentPerPeriodLabel')}</label>
          <input name="contentLimitMonthly" type="number" min="0" className="input" defaultValue={plan?.contentLimitMonthly ?? ''} placeholder={t('unlimitedPlaceholder')} />
        </div>
        <div>
          <label className="field-label">{t('videosPerDayLabel')}</label>
          <input name="videoLimitDaily" type="number" min="0" className="input" defaultValue={plan?.videoLimitDaily ?? ''} placeholder={t('unlimitedPlaceholder')} />
        </div>
      </div>
      <SubmitButton style={{ alignSelf: 'flex-start' }} pendingText={plan ? t('savingButton') : t('creatingButton')}>
        {plan ? t('saveChangesButton') : t('createPlanButton')}
      </SubmitButton>
    </form>
  );
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: { error?: string; saved?: string };
}) {
  const t = await getTranslations('admin.billing');
  const tDashboard = await getTranslations('admin.dashboard');
  const plans = await getBillingPlans();

  async function sync() {
    'use server';
    const result = await syncBillingPlansAction();
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? t('syncFailedError')));
    }
    redirect('/admin/billing?saved=synced');
  }

  async function del(formData: FormData) {
    'use server';
    const result = await deleteBillingPlanAction(formData);
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? t('deleteFailedError')));
    }
    redirect('/admin/billing?saved=deleted');
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{tDashboard('eyebrow')}</span>
          <h1>{t('title')}</h1>
        </div>
      </div>

      {searchParams.error && (
        <div className="banner warn" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">{t('actionFailedTitle')}</div>
            <div className="b">{searchParams.error}</div>
          </div>
        </div>
      )}

      {searchParams.saved && (
        <div className="banner ok" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">
              {searchParams.saved === 'created' && t('createdTitle')}
              {searchParams.saved === 'updated' && t('updatedTitle')}
              {searchParams.saved === 'synced' && t('syncedTitle')}
              {searchParams.saved === 'deleted' && t('deletedTitle')}
            </div>
            <div className="b">
              {searchParams.saved === 'created' && t('createdBody')}
              {searchParams.saved === 'updated' && t('updatedBody')}
              {searchParams.saved === 'synced' && t('syncedBody')}
              {searchParams.saved === 'deleted' && t('deletedBody')}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          {t('syncIntro')}
        </p>
        <form action={sync}>
          <SubmitButton className="btn" pendingText={t('syncingButton')}>{t('syncButton')}</SubmitButton>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {plans.map(p => (
          <div key={p.id}>
            <div className="eyebrow" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{p.name} · {fmt(p.monthlyPriceCents)}{intervalLabel(p.billingInterval, t)}</span>
              {!CORE_PLAN_IDS.has(p.id) && (
                <form action={del}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="btn" style={{ fontSize: 12 }} pendingText={t('deletingButton')}>{t('deletePlanButton')}</SubmitButton>
                </form>
              )}
            </div>
            <PlanForm plan={p} />
          </div>
        ))}
        {plans.length === 0 && (
          <div className="card"><p className="muted">{t('noPlans')}</p></div>
        )}
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('newPlanEyebrow')}</div>
        <PlanForm />
      </div>
    </div>
  );
}
