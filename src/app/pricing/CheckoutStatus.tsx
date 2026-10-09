'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SuccessIcon, AlertIcon } from '@/components/icons';

const POLL_MS = 3000;
const MAX_WAIT_MS = 60_000;

/**
 * Shown after Stripe sends the payer back with `?checkout=success`. The plan
 * is activated by the Stripe webhook, which usually lands a few seconds later,
 * so while `active` is false this re-renders the server page every 3s (for up
 * to a minute). Once the server sees `plan_id`, `active` flips and the
 * "Go to dashboard" action appears.
 */
export function CheckoutStatus({ active }: { active: boolean }) {
  const tp = useTranslations('pricing');
  const t = useTranslations('pricing.checkoutSuccess');
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  const timedOut = waited >= MAX_WAIT_MS;

  useEffect(() => {
    if (active || timedOut) return;
    const id = setInterval(() => {
      router.refresh();
      setWaited(w => w + POLL_MS);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, timedOut, router]);

  if (active) {
    return (
      <div className="alert alert-ok" role="status">
        <SuccessIcon className="icon" size={16} />
        <div className="alert-body">
          <div className="alert-title">{t('activeTitle')}</div>
          <div className="alert-text">{t('activeBody')}</div>
          <div className="alert-actions">
            <Link href="/dashboard" className="btn btn-primary btn-sm">{tp('goToDashboard')}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="alert alert-warn" role="status">
        <AlertIcon className="icon" size={16} />
        <div className="alert-body">
          <div className="alert-title">{t('timeoutTitle')}</div>
          <div className="alert-text">{t('timeoutBody')}</div>
          <div className="alert-actions">
            <button type="button" className="btn btn-sm" onClick={() => { setWaited(0); router.refresh(); }}>{t('refresh')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="alert alert-info" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div className="alert-body">
        <div className="alert-title">{t('title')}</div>
        <div className="alert-text">{t('waiting')}</div>
      </div>
    </div>
  );
}
