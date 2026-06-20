import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { getAllContentAdmin } from '@/lib/data';

const FILTERS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected'];

export default async function AdminContent({
  searchParams,
}: {
  searchParams: { status?: string; campaign?: string };
}) {
  const filter = searchParams.status && searchParams.status !== 'all'
    ? searchParams.status : undefined;
  const items = await getAllContentAdmin(filter);
  const filtered = searchParams.campaign
    ? items.filter(i => i.campaignId === searchParams.campaign)
    : items;

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Library</span>
          <h1>All content</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>{filtered.length} items</span>
        </div>
      </div>

      <div className="btnrow" style={{ marginBottom: 16 }}>
        {FILTERS.map(f => {
          const active = f === 'all' ? !filter : f === filter;
          return (
            <Link
              key={f}
              className="btn"
              href={f === 'all' ? '/admin/content' : `/admin/content?status=${f}`}
              style={active ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}>
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </Link>
          );
        })}
      </div>

      {searchParams.campaign && (
        <div className="banner" style={{ marginBottom: 14 }}>
          <div>
            <span className="t">Filtered by campaign</span>
            <Link href="/admin/content" style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }}>
              Clear filter →
            </Link>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Campaign</th>
              <th>Type</th>
              <th>Source</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600, color: 'var(--text)', maxWidth: 280 }}>
                  <Link href={`/content/${c.id}`}
                    style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit', textDecoration: 'none' }}>
                    {c.title}
                  </Link>
                </td>
                <td>
                  <Link href={`/admin/campaigns/${c.campaignId}`}
                    style={{ color: 'var(--text-2)', fontSize: 12.5, textDecoration: 'none' }}>
                    {c.campaignName}
                  </Link>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{c.type.replace('_', ' ')}</td>
                <td className="muted" style={{ fontSize: 12 }}>{c.isAiGenerated ? 'AI' : 'Human'}</td>
                <td><StatusPill status={c.status as never} /></td>
                <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 32, textAlign: 'center' }}>
                  No content with this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
