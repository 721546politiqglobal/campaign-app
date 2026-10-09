'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { openMyBillingPortalAction } from '@/app/actions';
import { SubmitButton } from '@/components/SubmitButton';

type PortalState = { ok: true } | { ok: false; error: string } | null;

/**
 * "Manage billing" → Stripe customer portal. On success the action redirects;
 * every failure (permission, Stripe not configured, no customer, API error)
 * comes back as a translated message shown next to the button.
 */
export function BillingPortalForm() {
  const t = useTranslations('billing');
  const [state, formAction] = useFormState<PortalState, FormData>(openMyBillingPortalAction, null);

  return (
    <form action={formAction} className="billing-portal">
      <SubmitButton pendingText={t('openingPortal')}>{t('manageBilling')}</SubmitButton>
      {state && !state.ok && <span className="field-error" role="alert">{state.error}</span>}
    </form>
  );
}
