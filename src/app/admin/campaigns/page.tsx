import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getAdminCampaignsPage, getCampaignTags, type CampaignSort } from '@/lib/data';
import type { CampaignStatusFilter } from '@/lib/campaign-filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { CampaignsTable } from '@/components/CampaignsTable';
import { SearchForm } from '../_components/SearchForm';
import { buildHref, parseDir, parseEnum, parsePage, parseQ, str, type SearchParams } from '../_components/query';
import { NewCampaignDialog } from './NewCampaignDialog';

const PATH = '/admin/campaigns';
const STATUS_FILTERS = ['all', 'active', 'inactive'] as const;
const SORTS = ['created', 'name'] as const;

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations('admin.campaigns');
  const tTable = await getTranslations('admin.campaignsTable');

  const q = parseQ(str(searchParams, 'q'));
  const status = parseEnum<CampaignStatusFilter>(str(searchParams, 'status'), STATUS_FILTERS, 'all');
  const tag = (str(searchParams, 'tag') ?? '').slice(0, 40);
  const sort = parseEnum<CampaignSort>(str(searchParams, 'sort'), SORTS, 'created');
  const dir = parseDir(str(searchParams, 'dir')) ?? (sort === 'name' ? 'asc' : 'desc');
  const page = parsePage(str(searchParams, 'page'));

  const [result, tags] = await Promise.all([
    getAdminCampaignsPage({ q, status, tag: tag || undefined, sort, dir, page }),
    getCampaignTags(),
  ]);

  const current = { q, status: status === 'all' ? undefined : status, tag: tag || undefined, sort: sort === 'created' ? undefined : sort, dir: sort === 'created' && dir === 'desc' ? undefined : dir };
  const href = (over: Record<string, string | number | undefined>) => buildHref(PATH, { ...current, ...over });

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<NewCampaignDialog defaultOpen={str(searchParams, 'new') === '1'} />}
      />

      <nav className="tabs" aria-label={tTable('colStatus')}>
        {STATUS_FILTERS.map(s => (
          <Link key={s} href={href({ status: s === 'all' ? undefined : s, page: undefined })} aria-current={status === s ? 'page' : undefined}>
            {s === 'all' ? t('filterAll') : s === 'active' ? t('filterActive') : t('filterInactive')}
          </Link>
        ))}
      </nav>

      <div className="admin-toolbar">
        <SearchForm
          action={PATH}
          q={q}
          placeholder={t('searchPlaceholder')}
          hidden={{ status: current.status, tag: current.tag, sort: current.sort, dir: current.dir }}
          clearHref={href({ q: undefined, page: undefined })}
        />
        {tags.length > 0 && (
          <div className="admin-chips" role="group" aria-label={t('tagFilterLabel')}>
            <Link href={href({ tag: undefined, page: undefined })} className={tag ? 'admin-chip' : 'admin-chip active'} aria-pressed={!tag}>
              {t('allTags')}
            </Link>
            {tags.map(tg => (
              <Link key={tg} href={href({ tag: tag === tg ? undefined : tg, page: undefined })} className={tag === tg ? 'admin-chip active' : 'admin-chip'} aria-pressed={tag === tg}>
                {tg}
              </Link>
            ))}
          </div>
        )}
      </div>

      <CampaignsTable
        page={result}
        sort={sort}
        dir={dir}
        filtered={!!(q || tag || status !== 'all')}
        hrefForPage={p => href({ page: p })}
        hrefForSort={(s, d) => href({ sort: s, dir: d, page: undefined })}
        newCampaignAction={<Link href={`${PATH}?new=1`} className="btn btn-primary">{t('newCampaign')}</Link>}
      />
    </div>
  );
}
