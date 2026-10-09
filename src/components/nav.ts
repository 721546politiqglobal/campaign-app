import type { IconName } from '@/components/icons';

/**
 * Navigation config shared by AppFrame (server), AppShellSkeleton (client) and
 * AdminFrame so the real shell and its loading skeleton never drift.
 * Labels are translation keys; the frames translate them.
 */
export interface NavItemConfig {
  href: string;
  /** Key under `common.nav.*` (app) or `admin.sidebar.*` (admin). */
  key: string;
  icon: IconName;
  /** Match only the exact path (used for index routes like /dashboard, /admin). */
  exact?: boolean;
}

export interface NavGroupConfig {
  /** Key under `common.navGroups.*`; omit for an unlabelled group. */
  key?: string;
  items: NavItemConfig[];
}

export const APP_NAV: NavGroupConfig[] = [
  {
    key: 'workspace',
    items: [
      { href: '/dashboard', key: 'dashboard', icon: 'dashboard', exact: true },
      { href: '/content', key: 'content', icon: 'content' },
      { href: '/monitoring', key: 'monitoring', icon: 'monitoring' },
      { href: '/analytics', key: 'analytics', icon: 'analytics' },
    ],
  },
  {
    key: 'assets',
    items: [
      { href: '/channels', key: 'channels', icon: 'channels' },
      { href: '/avatars', key: 'avatars', icon: 'avatars' },
    ],
  },
  {
    key: 'campaign',
    items: [
      { href: '/team', key: 'team', icon: 'team' },
      { href: '/billing', key: 'billing', icon: 'billing' },
      { href: '/settings', key: 'settings', icon: 'settings' },
    ],
  },
];

export const ADMIN_NAV: NavGroupConfig[] = [
  {
    items: [
      { href: '/admin', key: 'navOverview', icon: 'dashboard', exact: true },
      { href: '/admin/campaigns', key: 'navCampaigns', icon: 'campaign' },
      { href: '/admin/users', key: 'navUsers', icon: 'users' },
      { href: '/admin/content', key: 'navContent', icon: 'content' },
      { href: '/admin/audit', key: 'navAuditLog', icon: 'audit' },
      { href: '/admin/billing', key: 'navBilling', icon: 'billing' },
    ],
  },
];

/** Resolved nav (labels translated) consumed by AppShell. */
export interface NavItem { href: string; label: string; icon: IconName; exact?: boolean }
export interface NavGroup { label?: string; items: NavItem[] }

export function resolveNav(config: NavGroupConfig[], tItem: (key: string) => string, tGroup?: (key: string) => string): NavGroup[] {
  return config.map(g => ({
    label: g.key && tGroup ? tGroup(g.key) : undefined,
    items: g.items.map(i => ({ href: i.href, label: tItem(i.key), icon: i.icon, exact: i.exact })),
  }));
}
