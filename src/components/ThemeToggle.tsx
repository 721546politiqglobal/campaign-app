'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setThemeAction } from '@/app/theme-actions';
import { THEMES, type Theme } from '@/lib/theme-shared';
import { SunIcon, MoonIcon, MonitorIcon } from '@/components/icons';

const ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

/**
 * Light / dark / system segmented control. Applies the choice instantly on the
 * client (`<html data-theme>`), persists it in the `theme` cookie via a server
 * action, then refreshes so server-rendered markup agrees.
 *
 *   <ThemeToggle current={getTheme()} />            // server component parent
 *   <ThemeToggle current={theme} size="sm" />
 */
export function ThemeToggle({ current, size = 'md', className }: { current: Theme; size?: 'sm' | 'md'; className?: string }) {
  const t = useTranslations('common.theme');
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(current);
  const [, startTransition] = useTransition();

  const apply = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme; else root.dataset.theme = next;
    startTransition(() => {
      setThemeAction(next).then(() => router.refresh()).catch(() => { /* optimistic update already applied */ });
    });
  };

  return (
    <div
      className={`segmented segmented-icon theme-toggle${size === 'sm' ? ' segmented-sm' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={t('label')}
    >
      {THEMES.map((value) => {
        const IconCmp = ICONS[value];
        const checked = value === theme;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(value)}
            title={t(value)}
            onClick={() => apply(value)}
          >
            <IconCmp size={size === 'sm' ? 14 : 16} />
          </button>
        );
      })}
    </div>
  );
}
