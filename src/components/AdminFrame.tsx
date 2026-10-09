import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getTheme } from '@/lib/theme';
import { adminLogoutAction } from '@/app/admin/actions';
import { AppShell } from './AppShell';
import { ADMIN_NAV, resolveNav } from './nav';

export async function AdminFrame({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  const t = await getTranslations('admin.sidebar');
  const tCommon = await getTranslations('common');
  const nav = resolveNav(ADMIN_NAV, k => t(k));

  return (
    <AppShell
      variant="admin"
      nav={nav}
      theme={getTheme()}
      badge={t('badge')}
      user={{ name: s.name, roleLabel: tCommon(`roles.${s.role}`) }}
      signOutAction={adminLogoutAction}
    >
      {children}
    </AppShell>
  );
}
