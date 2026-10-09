import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getBillingPlans } from '@/lib/data';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { adminFormat } from '../_components/format';
import { PlanForm } from './PlanForm';
import { DeletePlanButton, SyncPlansForm } from './PlanActions';

const CORE_PLAN_IDS = new Set(PLAN_DEFINITIONS.map(d => d.id));

export default async function AdminBillingPage() {
  await requireAdmin();
  const t = await getTranslations('admin.billing');
  const f = await adminFormat();
  const plans = await getBillingPlans();

  return (
    <div className="stack">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t('syncHeading')}</h2>
            <p className="muted text-sm">{t('syncIntro')}</p>
          </div>
        </div>
        <SyncPlansForm />
      </section>

      {plans.length === 0 ? (
        <div className="card">
          <EmptyState icon="billing" title={t('noPlansTitle')} description={t('noPlansDesc')} />
        </div>
      ) : (
        plans.map(p => (
          <section key={p.id} className="card card-sectioned">
            <div className="card-header">
              <div className="card-header-text">
                <h2>{p.name}</h2>
                <span className="card-header-desc num">
                  {f.currency(p.monthlyPriceCents)}{p.billingInterval === 'week' ? t('perWeekSuffix') : t('perMonthSuffix')}
                </span>
              </div>
              <div className="card-header-actions">
                {CORE_PLAN_IDS.has(p.id)
                  ? <Badge tone="neutral" size="sm">{t('corePlanBadge')}</Badge>
                  : <DeletePlanButton plan={{ id: p.id, name: p.name }} />}
              </div>
            </div>
            <div className="card-body">
              <PlanForm plan={p} />
            </div>
          </section>
        ))
      )}

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t('newPlanHeading')}</h2>
            <p className="muted text-sm">{t('newPlanDesc')}</p>
          </div>
        </div>
        <PlanForm />
      </section>
    </div>
  );
}
