import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getAdminUsersPage, type UserSort } from '@/lib/data';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '../_components/Pagination';
import { SearchForm } from '../_components/SearchForm';
import { SortLink, ariaSort } from '../_components/SortLink';
import { adminFormat } from '../_components/format';
import { buildHref, parseDir, parseEnum, parsePage, parseQ, str, type SearchParams } from '../_components/query';
import { UserRowActions } from './UserRowActions';

const PATH = '/admin/users';
const SORTS = ['name', 'email', 'role', 'created'] as const;

export default async function AdminUsers({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations('admin.users');
  const tCommon = await getTranslations('common');
  const tAdmin = await getTranslations('admin.common');
  const f = await adminFormat();

  const q = parseQ(str(searchParams, 'q'));
  const sort = parseEnum<UserSort>(str(searchParams, 'sort'), SORTS, 'name');
  const dir = parseDir(str(searchParams, 'dir')) ?? (sort === 'created' ? 'desc' : 'asc');
  const page = parsePage(str(searchParams, 'page'));
  const result = await getAdminUsersPage({ q, sort, dir, page });

  const current = { q, sort: sort === 'name' ? undefined : sort, dir: sort === 'name' && dir === 'asc' ? undefined : dir };
  const href = (over: Record<string, string | number | undefined>) => buildHref(PATH, { ...current, ...over });
  const hrefForSort = (s: string, d: 'asc' | 'desc') => href({ sort: s, dir: d, page: undefined });

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        meta={<span className="subtle text-sm">{t('countSummary', { count: result.total })}</span>}
      />

      <div className="admin-toolbar">
        <SearchForm action={PATH} q={q} placeholder={t('searchPlaceholder')} hidden={{ sort: current.sort, dir: current.dir }} clearHref={href({ q: undefined, page: undefined })} />
      </div>

      {result.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="users"
            title={q ? tAdmin('noResults') : t('empty')}
            description={q ? tAdmin('noResultsDesc') : t('emptyDesc')}
            action={q ? <Link href={PATH} className="btn">{tAdmin('clearSearch')}</Link> : undefined}
          />
        </div>
      ) : (
        <div className="card card-sectioned">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-sort={ariaSort(sort, 'name', dir)}><SortLink column="name" label={t('colName')} sort={sort} dir={dir} hrefFor={hrefForSort} /></th>
                  <th aria-sort={ariaSort(sort, 'email', dir)}><SortLink column="email" label={t('colEmail')} sort={sort} dir={dir} hrefFor={hrefForSort} /></th>
                  <th aria-sort={ariaSort(sort, 'role', dir)}><SortLink column="role" label={t('colRole')} sort={sort} dir={dir} hrefFor={hrefForSort} /></th>
                  <th>{t('colCampaign')}</th>
                  <th aria-sort={ariaSort(sort, 'created', dir)}><SortLink column="created" label={t('colCreated')} sort={sort} dir={dir} defaultDir="desc" hrefFor={hrefForSort} /></th>
                  <th><span className="sr-only">{t('colActions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="admin-cell-primary">{u.name}</div>
                      <div className="admin-cell-sub mono">{u.id}</div>
                    </td>
                    <td className="text-sm">
                      {u.email ?? <span className="admin-bad-text">{t('noEmail')}</span>}
                    </td>
                    <td>
                      <Badge tone={u.role === 'owner' ? 'accent' : 'neutral'}>{tCommon(`roles.${u.role}`)}</Badge>
                    </td>
                    <td>
                      {u.campaignId && u.campaignName
                        ? <Link href={`/admin/campaigns/${u.campaignId}`} className="link">{u.campaignName}</Link>
                        : <span className="subtle">{t('noCampaign')}</span>}
                    </td>
                    <td className="admin-cell-nowrap subtle">{u.createdAt ? f.date(u.createdAt) : '—'}</td>
                    <td><UserRowActions user={{ id: u.id, name: u.name, campaignId: u.campaignId }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result} hrefFor={p => href({ page: p })} />
        </div>
      )}
    </div>
  );
}
