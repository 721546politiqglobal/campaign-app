import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getPerformanceSummary, getLatestInsight } from '@/lib/analytics';
import { getMonitoringResults } from '@/lib/data';

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className="mono" style={{ fontSize: 11, color: up ? 'var(--ok)' : 'var(--bad)', marginLeft: 8 }}>
      {up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

function BarList({ rows, labelKey }: { rows: { engagement: number; [k: string]: unknown }[]; labelKey: string }) {
  if (rows.length === 0) {
    return <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No data yet.</p>;
  }
  const max = Math.max(...rows.map(r => r.engagement), 1);
  return (
    <>
      {rows.map(r => (
        <div key={String(r[labelKey])} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ textTransform: 'capitalize' }}>{String(r[labelKey]).replace('_', ' ')}</span>
            <span className="mono">{r.engagement}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(r.engagement / max) * 100}%`, background: 'var(--accent-grad)', borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default async function AnalyticsPage() {
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [summary, insight, monitoring] = await Promise.all([
    getPerformanceSummary(s.campaignId),
    getLatestInsight(s.campaignId),
    getMonitoringResults(s.campaignId),
  ]);

  const hasData = summary.totals.postsCount > 0;

  const tiles = [
    { label: 'Reach', value: summary.totals.reach, delta: pctDelta(summary.totals.reach, summary.priorTotals.reach) },
    { label: 'Engagement', value: summary.totals.engagement, delta: pctDelta(summary.totals.engagement, summary.priorTotals.engagement) },
    { label: 'Engagement rate', value: summary.totals.impressions > 0 ? `${((summary.totals.engagement / summary.totals.impressions) * 100).toFixed(1)}%` : '—', delta: null },
    { label: 'Video watch time', value: `${summary.totals.videoAvgWatchSeconds.toFixed(0)}s`, delta: null },
  ];

  return (
    <AppFrame>
      <div style={{ marginBottom: 22 }}>
        <span className="eyebrow">Last 30 days</span>
        <h1 style={{ margin: '4px 0 0' }}>Analytics</h1>
      </div>

      {!hasData ? (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <p className="muted">Performance data will appear here once your published content has synced.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {tiles.map(t => (
              <div key={t.label} className="card" style={{ padding: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 12 }}>{t.label}</div>
                <div className="data" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                  {t.value}
                  <Delta value={t.delta} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>Top performing content</h2>
              {summary.topContent.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>Nothing published yet this period.</p>
              ) : (
                summary.topContent.map(c => (
                  <Link key={c.id} href={`/content/${c.id}`} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>{c.type.replace('_', ' ')}</span>
                    </div>
                    <span className="data" style={{ fontSize: 13, color: 'var(--accent)' }}>{c.engagement}</span>
                  </Link>
                ))
              )}
            </div>

            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>By platform</h2>
              <BarList rows={summary.byPlatform} labelKey="platform" />
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>By content type</h2>
              <BarList rows={summary.byContentType} labelKey="type" />
            </div>

            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>Opponent activity (context)</h2>
              <p className="muted" style={{ fontSize: 13 }}>
                Your campaign published <strong style={{ color: 'var(--text)' }}>{summary.totals.postsCount}</strong> pieces of content this period, versus{' '}
                <strong style={{ color: 'var(--text)' }}>{monitoring.length}</strong> tracked mentions of your opponent.
              </p>
            </div>
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 10px' }}>AI insight</h2>
            {insight ? (
              <>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>{insight.summary}</p>
                <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                  {insight.recommendations.map((r, i) => (
                    <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>{r}</li>
                  ))}
                </ul>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
                  Generated {new Date(insight.generatedAt).toLocaleDateString('en-US')}
                </div>
              </>
            ) : (
              <p className="muted" style={{ padding: '12px 0' }}>Check back after your next scheduled sync for AI-generated insights.</p>
            )}
          </div>
        </>
      )}
    </AppFrame>
  );
}
