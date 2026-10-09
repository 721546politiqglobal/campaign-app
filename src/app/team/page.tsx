import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/session';
import { getUsers, getInviteCodes, getCampaignSeatUsage } from '@/lib/data';
import { can } from '@/lib/permissions';
import { TeamManager } from '@/components/TeamManager';

export default async function TeamPage() {
  const t = await getTranslations('team');
  const format = await getFormatter();
  const s = await requireSession();
  const [users, inviteCodes, seatUsage] = await Promise.all([
    getUsers(s.campaignId),
    getInviteCodes(s.campaignId),
    getCampaignSeatUsage(s.campaignId),
  ]);
  const canManageTeam = can(s.role, 'manage_team');
  const now = Date.now();
  // Dates are formatted here (server, viewer's locale) rather than in the
  // client component: the browser's locale/time zone can differ from the
  // server's and would otherwise produce a hydration mismatch.
  const pendingInvites = canManageTeam
    ? inviteCodes.filter(inv => !inv.usedAt).map(inv => ({
      code: inv.code,
      role: inv.role,
      usedAt: inv.usedAt,
      expired: new Date(inv.expiresAt).getTime() < now,
      expiresLabel: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }),
      shareUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${inv.code}`,
    }))
    : [];

  return (
    <AppFrame>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <TeamManager
        members={users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
        invites={pendingInvites}
        seatUsage={seatUsage}
        canManage={canManageTeam}
        currentUserId={s.userId}
      />
    </AppFrame>
  );
}
