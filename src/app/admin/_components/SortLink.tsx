import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons';

/**
 * Column header link that toggles server-side sorting. Put it inside `<th>`
 * and set `aria-sort` on the `<th>` via `ariaSort()`.
 */
export async function SortLink({ column, label, sort, dir, defaultDir = 'asc', hrefFor }: {
  column: string;
  label: string;
  sort: string;
  dir: 'asc' | 'desc';
  defaultDir?: 'asc' | 'desc';
  hrefFor: (sort: string, dir: 'asc' | 'desc') => string;
}) {
  const t = await getTranslations('admin.common');
  const active = sort === column;
  const nextDir: 'asc' | 'desc' = active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir;
  return (
    <Link
      href={hrefFor(column, nextDir)}
      className={active ? 'admin-sort active' : 'admin-sort'}
      aria-label={`${t('sortBy', { column: label })}${active ? ` · ${dir === 'asc' ? t('sortedAsc') : t('sortedDesc')}` : ''}`}
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />)}
    </Link>
  );
}

export function ariaSort(sort: string, column: string, dir: 'asc' | 'desc'): 'ascending' | 'descending' | undefined {
  if (sort !== column) return undefined;
  return dir === 'asc' ? 'ascending' : 'descending';
}
