'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { Badge } from '@/components/ui/Badge';
import { SubmitButton } from '@/components/SubmitButton';
import { CheckIcon } from '@/components/icons';
import { startCheckoutAction, changePlanAction } from './actions';

/** Display-ready plan (prices / numbers already formatted in the active locale). */
export interface PlanView {
  id: string;
  name: string;
  price: string;
  interval: string;
  features: string[];
  isCurrent: boolean;
}

/**
 * `mode`: 'subscribe' — no plan yet, each card opens Stripe Checkout;
 * 'switch' — a subscription exists, switching is confirmed (prorated) first;
 * 'readonly' — the viewer can't manage billing, cards are informational.
 */
export type PricingMode = 'subscribe' | 'switch' | 'readonly';

export function PricingPlans({ plans, mode }: { plans: PlanView[]; mode: PricingMode }) {
  return (
    <div className="plan-grid" data-count={Math.min(plans.length, 4)}>
      {plans.map(plan => <PlanCard key={plan.id} plan={plan} mode={mode} />)}
    </div>
  );
}

function PlanCard({ plan, mode }: { plan: PlanView; mode: PricingMode }) {
  const t = useTranslations('pricing');
  const tErr = useTranslations('errors.pricing');
  const confirm = useConfirm();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const checkout = useMemo(() => startCheckoutAction.bind(null, plan.id), [plan.id]);
  const [rawCheckoutState, checkoutAction] = useFormState(checkout, INITIAL_FORM_STATE);
  // `undefined` while the redirect() to Stripe Checkout is followed (see form-state.ts).
  const checkoutState = rawCheckoutState ?? INITIAL_FORM_STATE;

  async function onSwitch() {
    const ok = await confirm({
      title: t('confirmSwitch.title', { plan: plan.name }),
      description: t('confirmSwitch.body'),
      confirmLabel: t('confirmSwitch.confirm'),
    });
    if (!ok) return;
    setBusy(true);
    setSwitchError(null);
    try {
      const result = await changePlanAction(plan.id);
      if (!result.ok) {
        setSwitchError(result.error ?? tErr('couldNotChangePlan'));
        return;
      }
      toast(t('planChanged'), 'success');
      router.push('/billing');
    } catch {
      toast(tErr('couldNotChangePlan'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const error = mode === 'switch' ? switchError : checkoutState.error;

  return (
    <article className={`card plan-card${plan.isCurrent ? ' is-current' : ''}`} aria-current={plan.isCurrent ? 'true' : undefined}>
      <div className="plan-card-head">
        <h2 className="plan-name">{plan.name}</h2>
        {plan.isCurrent && <Badge tone="accent" dot size="sm">{t('currentPlanBadge')}</Badge>}
      </div>
      <div className="plan-price">
        <span className="plan-price-amount num">{plan.price}</span>
        <span className="plan-price-interval">{t('perInterval', { interval: plan.interval })}</span>
      </div>
      <ul className="plan-features">
        {plan.features.map(f => (
          <li key={f}><CheckIcon size={14} className="plan-feature-icon" />{f}</li>
        ))}
      </ul>

      <div className="plan-card-foot">
        {error && <p className="field-error" role="alert">{error}</p>}
        {mode === 'readonly' ? null : plan.isCurrent ? (
          <button type="button" className="btn btn-block" disabled>{t('currentPlanButton')}</button>
        ) : mode === 'switch' ? (
          <button type="button" className="btn btn-primary btn-block" onClick={onSwitch} disabled={busy} aria-busy={busy}>
            {busy ? t('switching') : t('switchPlanButton')}
          </button>
        ) : (
          <form action={checkoutAction}>
            <SubmitButton block pendingText={t('redirecting')}>{t('subscribeButton')}</SubmitButton>
          </form>
        )}
      </div>
    </article>
  );
}
