import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getUsers, getInviteCodes, getCampaignSeatUsage } from '@/lib/data';
import { can } from '@/lib/permissions';
import { TeamManager } from '@/components/TeamManager';

export default async function TeamPage() {
  const s = await requireSession();
  const [users, inviteCodes, seatUsage] = await Promise.all([
    getUsers(s.campaignId),
    getInviteCodes(s.campaignId),
    getCampaignSeatUsage(s.campaignId),
  ]);
  const canManageTeam = can(s.role, 'manage_team');
  const invitesWithShareUrl = inviteCodes.map(inv => ({
    code: inv.code,
    role: inv.role,
    expiresAt: inv.expiresAt,
    usedAt: inv.usedAt,
    shareUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${inv.code}`,
  }));

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Team</h1></div>
      </div>

      <TeamManager
        members={users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
        invites={canManageTeam ? invitesWithShareUrl : []}
        seatUsage={seatUsage}
        canManage={canManageTeam}
      />
    </AppFrame>
  );
}
