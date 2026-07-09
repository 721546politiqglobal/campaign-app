import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { requireSession } from '@/lib/session';
import {
  getContentItems, getMonitoringResults, getMonthlySpend,
  getCampaign, getScheduledToday,
} from '@/lib/data';

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'IG', facebook: 'FB', x: 'X', linkedin: 'LI', tiktok: 'TK', youtube: 'YT',
};

export default async function Dashboard() {
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [items, monitoring, spend, campaign, todayScheduled] = await Promise.all([
    getContentItems(s.campaignId),
    getMonitoringResults(s.campaignId),
    getMonthlySpend(s.campaignId),
    getCampaign(s.campaignId),
    getScheduledToday(s.campaignId),
  ]);

  const needsAttention = items
    .filter(c => c.status === 'draft' || c.status === 'in_review')
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  const cap = campaign?.monthlyCostCapCents ?? 0;
  const spendPct = cap > 0 ? Math.min((spend / cap) * 100, 100) : 0;

  return (
    <AppFrame>
      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Overview</span>
          <h1 style={{ margin: '2px 0 0' }}>Today</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" href="/monitoring">Opponent feed</Link>
          <Link className="btn primary" href="/content/new">+ New content</Link>
        </div>
      </div>

      {/* Today's schedule strip */}
      {todayScheduled.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Going out today</div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {todayScheduled.map(item => (
              <Link key={item.id} href={`/content/${item.id}`} style={{
                display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px',
                border: '1px solid var(--line)', borderRadius: 10, minWidth: 180,
                background: 'var(--bg-hover)', textDecoration: 'none', color: 'inherit', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {item.platforms.slice(0, 3).map(p => (
                    <span key={p} style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 5px',
                      borderRadius: 4, background: 'var(--accent)', color: '#fff',
                    }}>{PLATFORM_ICON[p] ?? p.toUpperCase()}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
                  {item.title.slice(0, 48)}{item.title.length > 48 ? '…' : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {new Date(item.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {/* Needs attention */}
        <div className="card">
          <h2>Needs attention</h2>
          {needsAttention.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div className="muted" style={{ marginBottom: 12 }}>You&apos;re all caught up.</div>
              <Link className="btn primary" href="/content/new">Create new content</Link>
            </div>
          ) : (
            needsAttention.map(c => (
              <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <Link className="linkcell" href={`/content/${c.id}`}>{c.title}</Link>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.type.replace('_', ' ')} · updated {new Date(c.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <StatusPill status={c.status} />
              </div>
            ))
          )}
        </div>

        {/* Opponent pulse */}
        <div className="card">
          <h2>Opponent pulse</h2>
          {monitoring.slice(0, 3).map(m => (
            <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="eyebrow">{m.source}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{m.excerpt.slice(0, 120)}{m.excerpt.length > 120 ? '…' : ''}</div>
            </div>
          ))}
          {monitoring.length === 0 && <p className="muted">No monitoring results yet.</p>}
          <div className="spacer-y" />
          <Link className="btn" href="/monitoring">See full feed</Link>
        </div>
      </div>

      {/* Spend */}
      <div className="card" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Monthly spend</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            <span style={{ color: spendPct > 90 ? 'var(--bad)' : spendPct > 70 ? 'var(--warn)' : 'var(--text)', fontWeight: 600 }}>
              ${(spend / 100).toFixed(2)}
            </span>
            <span className="muted"> / ${(cap / 100).toFixed(2)}</span>
          </div>
        </div>
        <div style={{ flex: 1, height: 5, background: 'var(--bg-hover)', borderRadius: 3, minWidth: 0 }}>
          <div style={{
            height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
            width: `${spendPct}%`,
            background: spendPct > 90 ? 'var(--bad)' : spendPct > 70 ? 'var(--warn)' : 'var(--accent)',
          }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {spendPct.toFixed(0)}%
        </span>
      </div>
    </AppFrame>
  );
}
