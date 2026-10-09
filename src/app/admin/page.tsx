import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getSystemStats, getAdminCampaignsPage } from '@/lib/data';
import { PageHeader } from '@/components/ui/PageHeader';
import { Icon } from '@/components/icons';
import { CampaignsTable } from '@/components/CampaignsTable';
import { adminFormat } from './_components/format';
import { buildHref } from './_components/query';

const RECENT_LIMIT = 8;

export default async function AdminOverview() {
  // Defense in depth: the layout already gates on requireAdmin(), but every
  // admin page re-checks so a future layout change can't expose it (#16).
  await requireAdmin();
  const t = await getTranslations('admin.dashboard');
  const f = await adminFormat();
  const [stats, recent] = await Promise.all([
    getSystemStats(),
    getAdminCampaignsPage({ sort: 'created', dir: 'desc', pageSize: RECENT_LIMIT }),
  ]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/admin/campaigns?new=1" className="btn btn-primary">
            <Icon name="plus" size={16} />{t('newCampaign')}
          </Link>
        }
      />

      <div className="admin-stat-grid">
        <div className="card card-sm stat">
          <div className="stat-header">
            <span className="stat-label">{t('statCampaigns')}</span>
            <span className="stat-icon"><Icon name="campaign" size={16} /></span>
          </div>
          <div className="stat-value num">{f.integer(stats.campaignCount)}</div>
        </div>
        <div className="card card-sm stat">
          <div className="stat-header">
            <span className="stat-label">{t('statUsers')}</span>
            <span className="stat-icon"><Icon name="users" size={16} /></span>
          </div>
          <div className="stat-value num">{f.integer(stats.userCount)}</div>
        </div>
        <div className="card card-sm stat">
          <div className="stat-header">
            <span className="stat-label">{t('statContentItems')}</span>
            <span className="stat-icon"><Icon name="content" size={16} /></span>
          </div>
          <div className="stat-value num">{f.integer(stats.contentCount)}</div>
        </div>
        <Link href="/admin/content?status=in_review" className="card card-sm stat interactive">
          <div className="stat-header">
            <span className="stat-label">{t('statAwaitingReview')}</span>
            <span className="stat-icon"><Icon name="clock" size={16} /></span>
          </div>
          <div className={stats.inReviewCount > 0 ? 'stat-value num admin-warn-text' : 'stat-value num'}>
            {f.integer(stats.inReviewCount)}
          </div>
          <div className="stat-hint">{t('reviewHint', { count: stats.inReviewCount })}</div>
        </Link>
      </div>

      <section className="stack">
        <div className="section-header">
          <h2>{t('recentCampaigns')}</h2>
          <Link href="/admin/campaigns" className="link text-sm">{t('viewAllCampaigns')}</Link>
        </div>
        <CampaignsTable
          page={recent}
          sort="created"
          dir="desc"
          filtered={false}
          compact
          hrefForPage={p => buildHref('/admin/campaigns', { page: p })}
          hrefForSort={(sort, dir) => buildHref('/admin/campaigns', { sort, dir })}
          newCampaignAction={<Link href="/admin/campaigns?new=1" className="btn btn-primary">{t('newCampaign')}</Link>}
        />
      </section>
    </div>
  );
}
