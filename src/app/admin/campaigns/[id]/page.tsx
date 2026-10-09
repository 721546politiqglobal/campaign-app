import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import {
  getCampaignWithStats, getUsers, getAdminContentPage, getCampaignAuditEntries,
  getInviteCodes, getBillingPlans, getCampaignSeatUsage, getAvatarCount,
} from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { isCampaignActive } from '@/lib/campaign-filters';
import { adminFormat } from '../../_components/format';
import { SettingsCard } from './sections/SettingsCard';
import { BillingCard } from './sections/BillingCard';
import { AvatarVoiceCard } from './sections/AvatarVoiceCard';
import { TeamSection } from './sections/TeamSection';
import { ContentSection } from './sections/ContentSection';
import { ActivitySection } from './sections/ActivitySection';

const RECENT_CONTENT = 6;
const RECENT_ACTIVITY = 10;

export default async function CampaignDetail({ params }: { params: { id: string } }) {
  await requireAdmin();
  const t = await getTranslations('admin.campaigns.detail');
  const tTable = await getTranslations('admin.campaignsTable');
  const tBilling = await getTranslations('admin.billing');
  const f = await adminFormat();

  const campaign = await getCampaignWithStats(params.id);
  if (!campaign) notFound();

  const [users, content, audit, invites, profile, plans, avatarCount, seats] = await Promise.all([
    getUsers(campaign.id),
    getAdminContentPage({ campaignId: campaign.id, pageSize: RECENT_CONTENT }),
    getCampaignAuditEntries(campaign.id, RECENT_ACTIVITY),
    getInviteCodes(campaign.id),
    getCandidateProfile(campaign.id),
    getBillingPlans(),
    getAvatarCount(campaign.id),
    getCampaignSeatUsage(campaign.id),
  ]);

  const active = isCampaignActive(campaign.subscriptionStatus);

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={campaign.name}
        breadcrumb={[{ label: t('backToCampaigns'), href: '/admin/campaigns' }, { label: campaign.name }]}
        meta={<Badge tone={active ? 'ok' : 'neutral'} dot>{active ? tTable('active') : tTable('inactive')}</Badge>}
      />

      <div className="admin-stat-grid">
        <div className="card card-sm stat">
          <div className="stat-header"><span className="stat-label">{t('statUsers')}</span></div>
          <div className="stat-value num">{f.integer(campaign.userCount)}</div>
        </div>
        <div className="card card-sm stat">
          <div className="stat-header"><span className="stat-label">{t('statContent')}</span></div>
          <div className="stat-value num">{f.integer(campaign.contentCount)}</div>
        </div>
        <div className="card card-sm stat">
          <div className="stat-header"><span className="stat-label">{t('statInReview')}</span></div>
          <div className={campaign.inReviewCount > 0 ? 'stat-value num admin-warn-text' : 'stat-value num'}>{f.integer(campaign.inReviewCount)}</div>
        </div>
        <div className="card card-sm stat">
          <div className="stat-header"><span className="stat-label">{t('statCreated')}</span></div>
          <div className="stat-value admin-stat-date">{f.date(campaign.createdAt)}</div>
        </div>
      </div>

      <div className="admin-detail-grid">
        <SettingsCard campaign={{ id: campaign.id, name: campaign.name, jurisdictions: campaign.jurisdictions, tags: campaign.tags }} />
        <BillingCard
          campaign={{
            id: campaign.id,
            planId: campaign.planId,
            subscriptionStatus: campaign.subscriptionStatus,
            stripeCustomerId: campaign.stripeCustomerId,
            currentPeriodEndLabel: campaign.currentPeriodEnd ? f.date(campaign.currentPeriodEnd) : null,
          }}
          plans={plans.map(p => ({
            id: p.id,
            name: p.name,
            priceLabel: `${f.currency(p.monthlyPriceCents)}${p.billingInterval === 'week' ? tBilling('perWeekSuffix') : tBilling('perMonthSuffix')}`,
          }))}
        />
      </div>

      <AvatarVoiceCard
        campaignId={campaign.id}
        heygenBaseAvatarId={profile?.heygenBaseAvatarId ?? null}
        heygenVoiceId={profile?.heygenVoiceId ?? null}
        avatarCount={avatarCount}
      />

      <TeamSection campaignId={campaign.id} users={users} invites={invites} seats={seats} f={f} />

      <ContentSection campaignId={campaign.id} items={content.rows} total={content.total} f={f} />

      <ActivitySection campaignId={campaign.id} entries={audit} f={f} />
    </div>
  );
}
