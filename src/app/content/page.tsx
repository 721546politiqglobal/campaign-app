import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/icons';
import { requireSession } from '@/lib/session';
import { getContentItems } from '@/lib/data';
import type { ContentStatus } from '@/domain/types';

// Tabs always shown, in workflow order. rejected / archived only appear once
// something is actually in that state, so the bar stays short day to day.
const PRIMARY_FILTERS: ContentStatus[] = ['draft', 'in_review', 'approved', 'scheduled', 'published'];
const EXTRA_FILTERS: ContentStatus[] = ['rejected', 'archived'];
const ALL_STATUSES: ContentStatus[] = [...PRIMARY_FILTERS, 'publishing', ...EXTRA_FILTERS];

function parseStatus(raw: string | undefined): ContentStatus | undefined {
  return raw && (ALL_STATUSES as string[]).includes(raw) ? (raw as ContentStatus) : undefined;
}

const EMPTY_KEY: Partial<Record<ContentStatus, string>> = {
  draft: 'draft', in_review: 'inReview', approved: 'approved', scheduled: 'scheduled',
  published: 'published', rejected: 'rejected', archived: 'archived',
};

export default async function ContentList({ searchParams }: { searchParams: { status?: string } }) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations('content'),
    getTranslations('common.status'),
    getFormatter(),
  ]);
  const s = await requireSession();
  const filter = parseStatus(searchParams.status);
  // One query for everything: the tab counts need every status anyway, and a
  // campaign's library is small enough to filter in memory.
  const items = await getContentItems(s.campaignId);
  const counts = items.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  const visible = filter ? items.filter(c => c.status === filter) : items;
  const tabs: (ContentStatus | 'all')[] = [
    'all',
    ...PRIMARY_FILTERS,
    ...EXTRA_FILTERS.filter(st => (counts[st] ?? 0) > 0 || st === filter),
  ];

  const newLink = (
    <Link className="btn btn-primary" href="/content/new"><Icon name="plus" size={16} />{t('newContent')}</Link>
  );

  return (
    <AppFrame>
      <PageHeader
        eyebrow={t('library')}
        title={t('pageTitle')}
        description={t('description')}
        actions={newLink}
      />

      <nav className="tabs" aria-label={t('statusLabel')}>
        {tabs.map(f => {
          const active = f === 'all' ? !filter : f === filter;
          const n = f === 'all' ? items.length : (counts[f] ?? 0);
          return (
            <Link
              key={f}
              href={f === 'all' ? '/content' : `/content?status=${f}`}
              aria-current={active ? 'page' : undefined}
            >
              {f === 'all' ? t('allLabel') : tStatus(f)}
              <span className="count num">{format.number(n)}</span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <EmptyState
          icon="content"
          title={t('emptyState.title')}
          description={filter ? t(`emptyState.${EMPTY_KEY[filter] ?? 'default'}`) : t('emptyState.default')}
          action={filter
            ? <Link className="btn" href="/content">{t('allLabel')}</Link>
            : <Link className="btn btn-primary" href="/content/new"><Icon name="plus" size={16} />{t('createContent')}</Link>}
        />
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="content-table">
              <thead>
                <tr>
                  <th>{t('titleLabel')}</th>
                  <th>{t('typeLabel')}</th>
                  <th>{t('sourceLabel')}</th>
                  <th>{t('updatedLabel')}</th>
                  <th>{t('statusLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => (
                  <tr key={c.id}>
                    <td className="content-table-title">
                      <Link href={`/content/${c.id}`} className="row-link">{c.title}</Link>
                    </td>
                    <td>{t(`types.${c.type}`)}</td>
                    <td>{c.isAiGenerated ? t('aiGenerated') : t('human')}</td>
                    <td className="num">{format.dateTime(new Date(c.updatedAt), { dateStyle: 'medium' })}</td>
                    <td><StatusPill status={c.status} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppFrame>
  );
}
