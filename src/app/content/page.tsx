import Link from 'next/link';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { ClickableRow } from '@/components/ClickableRow';
import { requireSession } from '@/lib/session';
import { getContentItems } from '@/lib/data';
import { ContentStatus } from '@/domain/types';

const TYPE_LABEL: Record<string, string> = {
  reel: 'Reel', social_post: 'Social post', press_release: 'Press release',
  email: 'Email', sms: 'SMS', ad_copy: 'Ad copy', talking_points: 'Talking points',
};

export default async function ContentList({ searchParams }: { searchParams: { status?: string } }) {
  const s = requireSession();
  const filter = searchParams.status as ContentStatus | undefined;
  const items = await getContentItems(s.campaignId, filter);
  const filters: (ContentStatus | 'all')[] = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published'];

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Library</span><h1>Content</h1></div>
        <div className="actions"><Link className="btn primary" href="/content/new">New content</Link></div>
      </div>

      <div className="btnrow" style={{ marginBottom: 16 }}>
        {filters.map(f => (
          <Link key={f} className="btn" href={f === 'all' ? '/content' : `/content?status=${f}`}
            style={(f === 'all' && !filter) || f === filter ? { borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}>
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </Link>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>
            {items.map(c => (
              <ClickableRow key={c.id} href={`/content/${c.id}`}>
                <td><span className="linkcell">{c.title}</span></td>
                <td className="muted">{TYPE_LABEL[c.type] ?? c.type}</td>
                <td className="muted">{c.isAiGenerated ? 'AI-generated' : 'Human'}</td>
                <td><StatusPill status={c.status} /></td>
              </ClickableRow>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ padding: 24 }}>No content with this status yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}
