'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/Logo';
import { RefreshIcon } from '@/components/icons';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('system.error');

  useEffect(() => {
    // Keep the raw error out of the UI; surface it in the console for debugging.
    console.error(error);
  }, [error]);

  return (
    <div className="system-page">
      <div className="system-card">
        <Logo />
        <span className="system-code">{t('code')}</span>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <div className="system-actions">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            <RefreshIcon />
            {t('retry')}
          </button>
          <Link href="/dashboard" className="btn">{t('home')}</Link>
        </div>
        {error.digest && <span className="mono" style={{ marginTop: 8 }}>{error.digest}</span>}
      </div>
    </div>
  );
}
