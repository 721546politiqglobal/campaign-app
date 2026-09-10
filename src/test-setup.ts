// Vitest global setup. Provides dummy env for modules that construct clients at
// import time (e.g. src/lib/supabase.ts calls createClient at module load).
// These are placeholders — tests mock adminDb/stripe; no real network happens.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';

// next-intl's `next-intl/server` entrypoint has conditional exports keyed on
// the `react-server` resolve condition, which only Next.js's own build sets.
// Under plain Vitest (no Next.js build/request in flight) it resolves to the
// react-client build instead, whose `getTranslations` unconditionally throws
// "getTranslations is not supported in Client Components." — regardless of
// the locale passed. Rather than changing Vitest's global module resolution
// (risky: React itself has a `react-server` condition that disables
// client-only hooks, so flipping this on could silently break unrelated
// tests), mock just this one module so server actions under test can call
// the explicit-locale `getTranslations({ locale, namespace })` form. This
// reads the REAL src/messages/{locale}.json files at test time, so
// `t('someKey')` in a test resolves to whatever the actual message file
// says — assertions stay meaningful and track real translated content.
//
// The translator itself is next-intl's OWN implementation (`createTranslator`
// from `use-intl/core`, the runtime next-intl is built on and already a
// dependency), not a hand-rolled `{var}` substituter. That buys real ICU
// MessageFormat evaluation (so `{count, plural, ...}` works the way it does in
// production) plus `.rich`/`.markup`/`.raw`/`.has`. `onError` rethrows instead
// of logging, so a message key that does not exist in the message files fails
// the test loudly rather than silently rendering its own key path.
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { vi } from 'vitest';
import { createTranslator } from 'use-intl/core';

function loadMessages(locale: string) {
  const path = resolvePath(__dirname, `messages/${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Callers use both `getTranslations('namespace')` (ambient locale, Server
// Components) and `getTranslations({ locale, namespace })` (explicit locale,
// server actions) — accept either shape.
type GetTranslationsArg = string | { locale?: string; namespace?: string } | undefined;

vi.mock('next-intl/server', () => ({
  getTranslations: async (arg?: GetTranslationsArg) => {
    const { locale, namespace } = typeof arg === 'string' ? { locale: undefined, namespace: arg } : (arg ?? {});
    const resolvedLocale = locale ?? 'en';
    return createTranslator({
      locale: resolvedLocale,
      messages: loadMessages(resolvedLocale),
      namespace,
      timeZone: 'UTC',
      onError: (error: unknown) => { throw error; },
    } as any);
  },
  getMessages: async (arg?: { locale?: string }) => loadMessages(arg?.locale ?? 'en'),
  // Not implemented on purpose — src/i18n/request.ts is the only caller and no
  // test exercises it. Fail loudly and self-describingly if that changes.
  getRequestConfig: () => {
    throw new Error("getRequestConfig is not implemented by the test-setup.ts next-intl/server mock — extend it if a test needs this");
  },
}));
