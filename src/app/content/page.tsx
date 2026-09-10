import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { ClickableRow } from '@/components/ClickableRow';
import { requireSession } from '@/lib/session';
import { getContentItems } from '@/lib/data';
import { ContentStatus } from '@/domain/types';

export default async function ContentList({ searchParams }: { searchParams: { status?: string } }) {
  const t = await getTranslations('content');
  const s = await requireSession();
  const filter = searchParams.status as ContentStatus | undefined;
  const items = await getContentItems(s.campaignId, filter);
  const filters: (ContentStatus | 'all')[] = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published'];

  const FILTER_LABEL: Record<string, string> = {
    all: t('filters.all'), draft: t('filters.draft'), in_review: t('filters.inReview'),
    approved: t('filters.approved'), scheduled: t('filters.scheduled'), published: t('filters.published'),
  };

  const EMPTY_LABEL: Record<string, string> = {
    draft: t('emptyState.draft'), in_review: t('emptyState.inReview'), approved: t('emptyState.approved'),
    scheduled: t('emptyState.scheduled'), published: t('emptyState.published'),
  };

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('library')}</span><h1>{t('pageTitle')}</h1></div>
        <div className="actions"><Link className="btn primary" href="/content/new">{t('newContent')}</Link></div>
      </div>

      <div className="btnrow" style={{ marginBottom: 20 }}>
        {filters.map(f => (
          <Link
            key={f}
            className={`btn${((f === 'all' && !filter) || f === filter) ? ' active' : ''}`}
            href={f === 'all' ? '/content' : `/content?status=${f}`}
          >
            {FILTER_LABEL[f] ?? f}
          </Link>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>{t('titleLabel')}</th><th>{t('typeLabel')}</th><th>{t('sourceLabel')}</th><th>{t('statusLabel')}</th></tr></thead>
          <tbody>
            {items.map(c => (
              <ClickableRow key={c.id} href={`/content/${c.id}`}>
                <td><span className="linkcell">{c.title}</span></td>
                <td className="muted">{t(`types.${c.type}`)}</td>
                <td className="muted">{c.isAiGenerated ? t('aiGenerated') : t('human')}</td>
                <td><StatusPill status={c.status} /></td>
              </ClickableRow>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden style={{ opacity: 0.25 }}>
                      <rect x="4" y="3" width="32" height="34" rx="4" stroke="currentColor" strokeWidth="2"/>
                      <line x1="11" y1="13" x2="29" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="11" y1="19" x2="29" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="11" y1="25" x2="21" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {filter ? (EMPTY_LABEL[filter] ?? t('emptyState.default')) : t('emptyState.default')}
                    </span>
                    {!filter && (
                      <a href="/content/new" className="btn primary" style={{ marginTop: 4 }}>{t('createContent')}</a>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}
