import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { requireSession } from '@/lib/session';
import {
  getContentItems, getMonitoringResults, getMonthlySpend, getScheduledToday,
} from '@/lib/data';

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'IG', facebook: 'FB', x: 'X', linkedin: 'LI', tiktok: 'TK', youtube: 'YT',
};

const CRED_COLOR: Record<string, string> = {
  high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--bad)',
};

export default async function Dashboard() {
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [items, monitoring, spend, todayScheduled] = await Promise.all([
    getContentItems(s.campaignId),
    getMonitoringResults(s.campaignId),
    getMonthlySpend(s.campaignId),
    getScheduledToday(s.campaignId),
  ]);

  const needsAttention = items
    .filter(c => c.status === 'draft' || c.status === 'in_review')
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  const count = (st: string) => items.filter(c => c.status === st).length;
  const reviewN = count('draft') + count('in_review');
  const scheduledN = count('scheduled');
  const publishedN = count('published');
  const signalsN = monitoring.length;

  const tiles = [
    { label: 'Needs review', n: reviewN, tone: reviewN > 0 ? 'var(--warn)' : 'var(--text-3)', href: '/content?f=in_review', sub: reviewN === 1 ? '1 item waiting' : `${reviewN} items waiting` },
    { label: 'Scheduled', n: scheduledN, tone: 'var(--purple)', href: '/content?f=scheduled', sub: 'queued to publish' },
    { label: 'Published', n: publishedN, tone: 'var(--ok)', href: '/content?f=published', sub: 'live on socials' },
    { label: 'Opp. signals', n: signalsN, tone: 'var(--live)', href: '/monitoring', sub: 'in the feed' },
  ];

  return (
    <AppFrame>
      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22, gap: 16 }}>
        <div>
          <span className="eyebrow">Overview</span>
          <h1 style={{ margin: '4px 0 0' }}>Today</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" href="/monitoring">Opponent feed</Link>
          <Link className="btn primary" href="/content/new">+ New content</Link>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {tiles.map(t => (
          <Link key={t.label} href={t.href} className="card interactive" style={{ padding: 16, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="eyebrow">{t.label}</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.tone, boxShadow: `0 0 8px ${t.tone}`, flexShrink: 0 }} />
            </div>
            <div className="data" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: 'var(--text)' }}>
              {String(t.n).padStart(2, '0')}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t.sub}</div>
          </Link>
        ))}
      </div>

      {/* Today's schedule strip */}
      {todayScheduled.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Going out today</div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {todayScheduled.map(item => (
              <Link key={item.id} href={`/content/${item.id}`} className="card interactive" style={{
                display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 15px', minWidth: 190,
                textDecoration: 'none', color: 'inherit', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {item.platforms.slice(0, 3).map(p => (
                    <span key={p} className="mono" style={{
                      fontSize: 9.5, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)',
                      border: '1px solid rgba(249,115,22,0.25)', letterSpacing: '0.05em',
                    }}>{PLATFORM_ICON[p] ?? p.toUpperCase()}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                  {item.title.slice(0, 48)}{item.title.length > 48 ? '…' : ''}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
                  {new Date(item.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1.35fr 1fr', gap: 14 }}>
        {/* Needs attention */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Needs attention</h2>
            {needsAttention.length > 0 && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{needsAttention.length}</span>
            )}
          </div>
          {needsAttention.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <div className="muted" style={{ marginBottom: 14 }}>You&apos;re all caught up — nothing waiting on you.</div>
              <Link className="btn primary" href="/content/new">Create new content</Link>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {needsAttention.map(c => (
                <Link key={c.id} href={`/content/${c.id}`} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '12px 10px', margin: '0 -10px', borderRadius: 8,
                  textDecoration: 'none', color: 'inherit', borderBottom: '1px solid var(--line)',
                }} className="row-hover">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.type.replace('_', ' ')}</span>
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>·</span>
                      <span className="muted" style={{ fontSize: 11.5 }}>updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <StatusPill status={c.status} />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Opponent pulse */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Opponent pulse</h2>
            {signalsN > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--live)', letterSpacing: '0.08em' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px var(--live)' }} />LIVE
              </span>
            )}
          </div>
          {monitoring.length === 0 ? (
            <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No opponent activity picked up yet.</p>
          ) : (
            <div style={{ marginTop: 6 }}>
              {monitoring.slice(0, 3).map(m => (
                <div key={m.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: CRED_COLOR[m.credibility] ?? 'var(--text-3)', flexShrink: 0 }} />
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.source}</span>
                  </div>
                  <div className="excerpt-clamp" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{m.excerpt}</div>
                </div>
              ))}
            </div>
          )}
          <div className="spacer-y" />
          <Link className="btn" href="/monitoring" style={{ width: '100%', justifyContent: 'center' }}>See full feed</Link>
        </div>
      </div>

      {/* Spend */}
      <div className="card" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Spend this billing period</div>
          <span className="data" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>
            ${(spend / 100).toFixed(2)}
          </span>
        </div>
      </div>
    </AppFrame>
  );
}
