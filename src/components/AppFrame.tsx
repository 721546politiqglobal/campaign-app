import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCampaign } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { getTheme } from '@/lib/theme';
import { logoutAction } from '@/app/actions';
import { AppShell } from './AppShell';
import { APP_NAV, resolveNav } from './nav';

export async function AppFrame({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const t = await getTranslations('common');

  const campaign = await getCampaign(s.campaignId);

  // super_admin manages all campaigns — no profile or plan required
  if (s.role !== 'super_admin') {
    const profile = await getCandidateProfile(s.campaignId);
    if (!profile) redirect('/setup');
    if (!campaign?.planId) redirect('/pricing');
  }

  const nav = resolveNav(APP_NAV, k => t(`nav.${k}`), k => t(`navGroups.${k}`));

  return (
    <AppShell
      nav={nav}
      theme={getTheme()}
      campaignName={campaign?.name ?? ''}
      user={{ name: s.name, roleLabel: t(`roles.${s.role}`) }}
      signOutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
