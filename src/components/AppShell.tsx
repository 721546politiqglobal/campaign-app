'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon, MenuIcon, XIcon, LogoutIcon } from '@/components/icons';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SubmitButton } from '@/components/SubmitButton';
import type { NavGroup } from '@/components/nav';
import type { Theme } from '@/lib/theme-shared';

/**
 * The authenticated application shell: a 248px sidebar (logo, campaign block,
 * grouped nav, user block with theme toggle + sign out) and the main content
 * column. Below 900px the sidebar becomes an off-canvas drawer opened from a
 * sticky top bar. AppFrame, AdminFrame and AppShellSkeleton all render this
 * same component so the real shell and its loading state never drift.
 *
 * Pass `loading` to render the user block as skeleton bars (no theme / sign
 * out controls) — used by route-level `loading.tsx` files.
 */
export interface AppShellProps {
  nav: NavGroup[];
  variant?: 'app' | 'admin';
  theme?: Theme;
  /** Campaign name shown in the brand block (app variant). */
  campaignName?: string;
  /** Badge shown next to the logo (admin variant). */
  badge?: string;
  user?: { name: string; roleLabel: string };
  signOutAction?: () => Promise<void>;
  loading?: boolean;
  children: ReactNode;
}

export function AppShell({ nav, variant = 'app', theme = 'system', campaignName, badge, user, signOutAction, loading, children }: AppShellProps) {
  const t = useTranslations('common');
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Close the drawer on navigation.
  useEffect(() => { setOpen(false); }, [path]);

  // Escape closes; lock body scroll; manage focus in and out of the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      menuButtonRef.current?.focus();
    };
  }, [open, close]);

  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const initials = user?.name ? user.name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() : '';

  return (
    <div className={`shell${open ? ' drawer-open' : ''}`}>
      <aside className="sidebar" id={sidebarId} aria-label={t('mainNavigation')}>
        <div className="sidebar-head">
          <div className="brand">
            <div className="brand-mark">
              <Logo className="brand-logo-img" />
              {badge && <span className="admin-badge">{badge}</span>}
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="btn btn-ghost btn-icon btn-sm sidebar-close" onClick={close} aria-label={t('menu.close')}>
            <XIcon />
          </button>
        </div>

        {variant === 'app' && (
          <div className="sidebar-campaign-slot">
            {loading
              ? <div className="skeleton sk-campaign" />
              : (
                <div className="brand-campaign" title={campaignName}>
                  <span className="brand-campaign-label">{t('navGroups.campaign')}</span>
                  {campaignName}
                </div>
              )}
          </div>
        )}

        <nav className="sidebar-nav">
          {nav.map((group, gi) => (
            <div className="nav-group" key={group.label ?? gi}>
              {group.label && <div className="nav-group-label">{group.label}</div>}
              <div className="nav">
                {group.items.map(item => {
                  const active = isActive(item.href, item.exact);
                  return (
                    <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                      <Icon name={item.icon} className="nav-icon" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {loading || !user ? (
            <>
              <div className="sidebar-user">
                <div className="skeleton sk-avatar" />
                <div className="sidebar-user-text sk-grow">
                  <div className="skeleton sk-user-name" />
                  <div className="skeleton sk-user-role" />
                </div>
              </div>
              <div className="sidebar-user-row">
                <div className="skeleton sk-user-btn" />
                <div className="skeleton sk-user-btn-sm" />
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-user">
                <div className="sidebar-avatar" aria-hidden="true">{initials}</div>
                <div className="sidebar-user-text">
                  <span className="sidebar-user-name" title={user.name}>{user.name}</span>
                  <span><span className="rolebadge">{user.roleLabel}</span></span>
                </div>
              </div>
              <div className="sidebar-user-row">
                <ThemeToggle current={theme} size="sm" />
                {signOutAction && (
                  <form action={signOutAction}>
                    <SubmitButton variant="ghost" size="sm" pendingText={t('signingOut')}>
                      <LogoutIcon size={14} />
                      {t('signOut')}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      <div className="shell-backdrop" onClick={close} aria-hidden="true" />

      <div className="main">
        <header className="shell-topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls={sidebarId}
            aria-label={t('menu.open')}
          >
            <MenuIcon size={18} />
          </button>
          <Logo className="brand-logo-img" />
          {badge
            ? <span className="admin-badge">{badge}</span>
            : campaignName && !loading && <span className="shell-topbar-title">{campaignName}</span>}
        </header>
        <main className={variant === 'admin' ? 'admin-content' : 'content'} aria-busy={loading || undefined}>
          {children}
        </main>
      </div>
    </div>
  );
}
