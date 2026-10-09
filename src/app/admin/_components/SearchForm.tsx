import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SearchIcon } from '@/components/icons';

/**
 * GET search box for admin lists. Submits `?q=` (plus the `hidden` params so
 * the active filter/sort survives a search); resets to page 1 by omission.
 */
export async function SearchForm({ action, q, placeholder, hidden = {}, clearHref }: {
  action: string;
  q: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
  clearHref: string;
}) {
  const t = await getTranslations('admin.common');
  return (
    <form method="get" action={action} role="search" className="admin-search">
      {Object.entries(hidden).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <label className="sr-only" htmlFor="admin-search-q">{t('search')}</label>
      <div className="input-group">
        <span className="input-prefix" aria-hidden="true"><SearchIcon size={16} /></span>
        <input id="admin-search-q" name="q" type="search" className="input" defaultValue={q} placeholder={placeholder} maxLength={100} />
      </div>
      <button type="submit" className="btn">{t('searchButton')}</button>
      {q && <Link href={clearHref} className="btn btn-ghost">{t('clearSearch')}</Link>}
    </form>
  );
}
