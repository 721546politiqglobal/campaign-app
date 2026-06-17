import { requireSession } from '@/lib/session';
import { getCampaign } from '@/lib/data';
import { Sidebar } from './Sidebar';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', approver: 'Approver', staff: 'Staff',
};

export async function AppFrame({ children }: { children: React.ReactNode }) {
  const s = requireSession();
  const campaign = await getCampaign(s.campaignId);
  return (
    <div className="shell">
      <Sidebar name={s.name} campaign={campaign?.name ?? ''} />
      <div className="main">
        <div className="topbar">
          <span className="eyebrow">Workspace</span>
          <span className="ws">{campaign?.name}</span>
          <div className="right">
            <span className="rolebadge">{ROLE_LABEL[s.role] ?? s.role}</span>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
