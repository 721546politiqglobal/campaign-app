'use client';

import { useEffect, useState } from 'react';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import './globals.css';

// global-error replaces the root layout, so there is no NextIntlClientProvider
// (or locale cookie) to read. Pick the language from the browser and read the
// `system.error` strings straight from the message catalogs.
const MESSAGES = { en: en.system.error, es: es.system.error } as const;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<keyof typeof MESSAGES>('en');
  const t = MESSAGES[locale];

  useEffect(() => {
    console.error(error);
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) setLocale('es');
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <div className="system-page">
          <div className="system-card">
            <img src="/politiq-logo-dark.png" alt="PolitIQ" className="brand-logo-img logo-on-light" />
            <img src="/politiq-logo.png" alt="PolitIQ" className="brand-logo-img logo-on-dark" />
            <span className="system-code">{t.code}</span>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
            <div className="system-actions">
              <button type="button" className="btn btn-primary" onClick={() => reset()}>{t.retry}</button>
              <a href="/" className="btn">{t.home}</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
