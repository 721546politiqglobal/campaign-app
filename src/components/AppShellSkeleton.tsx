'use client';

import { useTranslations } from 'next-intl';
import { AppShell } from './AppShell';
import { APP_NAV, resolveNav } from './nav';

/**
 * Route-level loading fallback. Renders the exact same AppShell as AppFrame
 * (nav is static and known) with the campaign / user blocks as skeleton bars,
 * so the transition into the real page is seamless. Page content goes in
 * `children` — see src/app/dashboard/loading.tsx for an example.
 */
export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const nav = resolveNav(APP_NAV, k => t(`nav.${k}`), k => t(`navGroups.${k}`));
  return <AppShell nav={nav} loading>{children}</AppShell>;
}
