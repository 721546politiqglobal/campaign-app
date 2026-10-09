'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { BillingPlan } from '@/lib/data';
import { upsertBillingPlanAction } from './actions';
import { ActionForm } from '../_components/ActionForm';

/** Create / edit form for one billing plan (client: inline errors + toast). */
export function PlanForm({ plan }: { plan?: BillingPlan }) {
  const t = useTranslations('admin.billing');
  const isNew = !plan;

  return (
    <ActionForm action={upsertBillingPlanAction} successMessage={isNew ? t('planCreated') : t('planUpdated')}>
      {({ values }) => (
        <div className="stack">
          <input type="hidden" name="id" value={plan?.id ?? ''} />
          <div className="admin-plan-grid">
            <Field label={t('planNameLabel')} required>
              {p => <input {...p} name="name" className="input" defaultValue={values.name ?? plan?.name ?? ''} required maxLength={80} />}
            </Field>
            <Field label={t('priceLabel')} required>
              {p => <input {...p} name="priceDollars" type="number" step="0.01" min="0" className="input" defaultValue={values.priceDollars ?? (plan ? (plan.monthlyPriceCents / 100).toFixed(2) : '')} required />}
            </Field>
            <Field label={t('billingIntervalLabel')}>
              {p => (
                <select {...p} name="billingInterval" className="input" defaultValue={values.billingInterval ?? plan?.billingInterval ?? 'month'}>
                  <option value="week">{t('weekly')}</option>
                  <option value="month">{t('monthly')}</option>
                </select>
              )}
            </Field>
          </div>
          <fieldset className="admin-fieldset">
            <legend className="eyebrow">{t('limitsLegend')}</legend>
            <div className="admin-limits-grid">
              <Field label={t('memberLimitLabel')}>
                {p => <input {...p} name="seatLimit" type="number" min="0" className="input" defaultValue={values.seatLimit ?? plan?.seatLimit ?? ''} placeholder={t('unlimitedPlaceholder')} />}
              </Field>
              <Field label={t('avatarLimitLabel')}>
                {p => <input {...p} name="avatarLimit" type="number" min="0" className="input" defaultValue={values.avatarLimit ?? plan?.avatarLimit ?? ''} placeholder={t('unlimitedPlaceholder')} />}
              </Field>
              <Field label={t('contentPerPeriodLabel')}>
                {p => <input {...p} name="contentLimitMonthly" type="number" min="0" className="input" defaultValue={values.contentLimitMonthly ?? plan?.contentLimitMonthly ?? ''} placeholder={t('unlimitedPlaceholder')} />}
              </Field>
              <Field label={t('videosPerDayLabel')}>
                {p => <input {...p} name="videoLimitDaily" type="number" min="0" className="input" defaultValue={values.videoLimitDaily ?? plan?.videoLimitDaily ?? ''} placeholder={t('unlimitedPlaceholder')} />}
              </Field>
            </div>
          </fieldset>
          <div className="form-actions">
            <SubmitButton pendingText={isNew ? t('creatingButton') : t('savingButton')}>
              {isNew ? t('createPlanButton') : t('saveChangesButton')}
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
