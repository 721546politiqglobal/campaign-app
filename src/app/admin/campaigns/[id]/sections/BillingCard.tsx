'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { ExternalIcon } from '@/components/icons';
import { assignPlanAction, openBillingPortalForCampaignAction } from '../../../actions';
import { ActionForm } from '../../../_components/ActionForm';

export interface BillingCardProps {
  campaign: {
    id: string;
    planId: string | null;
    subscriptionStatus: string | null;
    stripeCustomerId: string | null;
    currentPeriodEndLabel: string | null;
  };
  plans: { id: string; name: string; priceLabel: string }[];
}

export function BillingCard({ campaign, plans }: BillingCardProps) {
  const t = useTranslations('admin.campaigns.detail');
  const currentPlan = plans.find(p => p.id === campaign.planId);
  const status = campaign.subscriptionStatus;
  const dotClass = status === 'active' || status === 'trialing' ? 'admin-dot ok' : status ? 'admin-dot warn' : 'admin-dot';

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t('billingHeading')}</h2>
          <p className="muted text-sm">{t('billingDesc')}</p>
        </div>
      </div>

      <div className="stack">
        <div className="admin-status-line">
          <span className={dotClass} aria-hidden="true" />
          <span className="admin-cell-primary">
            {campaign.planId
              ? t('planStatusLine', { planName: currentPlan?.name ?? campaign.planId, status: status ?? t('unknownStatus') })
              : t('noPlanAssigned')}
          </span>
          {campaign.currentPeriodEndLabel && (
            <span className="subtle text-sm">· {t('currentPeriodEnds', { date: campaign.currentPeriodEndLabel })}</span>
          )}
        </div>

        <ActionForm
          action={assignPlanAction}
          successMessage={t('planAssigned')}
          className="admin-inline-form"
          confirm={fd => {
            const planName = plans.find(p => p.id === String(fd.get('planId')))?.name ?? '';
            return campaign.planId
              ? { title: t('changePlanTitle', { plan: planName }), description: t('changePlanDesc'), confirmLabel: t('confirmChange') }
              : { title: t('assignPlanTitle', { plan: planName }), description: t('assignPlanDesc'), confirmLabel: t('confirmAssign') };
          }}
        >
          <input type="hidden" name="campaignId" value={campaign.id} />
          <Field label={t('planLabel')} className="field-narrow">
            {p => (
              <select {...p} name="planId" className="input" defaultValue={campaign.planId ?? ''} required>
                <option value="" disabled>{t('selectPlanOption')}</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.priceLabel}</option>)}
              </select>
            )}
          </Field>
          <SubmitButton pendingText={t('assigningButton')}>
            {campaign.planId ? t('changePlanButton') : t('assignPlanButton')}
          </SubmitButton>
        </ActionForm>

        {campaign.stripeCustomerId ? (
          <div className="btnrow">
            <ActionForm action={openBillingPortalForCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <SubmitButton variant="secondary" size="sm" pendingText={t('openingPortal')}>{t('openBillingPortalButton')}</SubmitButton>
            </ActionForm>
            <a
              href={`https://dashboard.stripe.com/customers/${campaign.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              {t('viewInStripeDashboard')}<ExternalIcon size={14} />
            </a>
          </div>
        ) : (
          <p className="subtle text-sm">{t('noStripeCustomerHint')}</p>
        )}
      </div>
    </section>
  );
}
