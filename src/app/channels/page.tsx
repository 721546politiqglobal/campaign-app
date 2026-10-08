import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { ChannelsManager } from '@/components/ChannelsManager';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getCampaignSocialProfile } from '@/lib/channels';

export default async function ChannelsPage({ searchParams }: { searchParams: { linked?: string; mock_link?: string } }) {
  const t = await getTranslations('channels');
  const s = await requireSession();
  // The profile key stays on the server — only the account snapshot crosses.
  const { accounts } = await getCampaignSocialProfile(s.campaignId);

  return (
    <AppFrame>
      <ChannelsManager
        initialAccounts={accounts}
        canManage={can(s.role, 'edit_settings')}
        returnedFromLink={searchParams.linked === '1'}
        mockLink={!!searchParams.mock_link}
        eyebrow={t('eyebrow')}
      />
    </AppFrame>
  );
}
