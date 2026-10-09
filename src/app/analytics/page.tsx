import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons';
import { requireSession } from '@/lib/session';
import { getPerformanceSummary, getLatestInsight } from '@/lib/analytics';
import { getMonitoringResults } from '@/lib/data';
import { rowCountLabel } from '@/lib/row-cap';
import { renderInlineMarkdown, renderMarkdownLite } from '@/lib/markdown-lite';

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

function Delta({ value, t }: { value: number | null; t: Translator }) {
  if (value === null) return null;
  const up = value >= 0;
  const label = t(up ? 'deltaUp' : 'deltaDown', { value: Math.abs(value) });
  return (
    <span className={`stat-delta num ${up ? 'up' : 'down'}`} title={label}>
      {up ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
      <span aria-hidden="true">{Math.abs(value)}%</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function BarList({ rows, emptyLabel, format }: {
  rows: { key: string; label: string; engagement: number }[];
  emptyLabel: string;
  format: Formatter;
}) {
  if (rows.length === 0) return <p className="muted text-sm an-empty">{emptyLabel}</p>;
  const max = Math.max(...rows.map(r => r.engagement), 1);
  return (
    <ul className="an-bars">
      {rows.map(r => (
        <li key={r.key} className="an-bar">
          <div className="an-bar-head">
            <span className="an-bar-label">{r.label}</span>
            <span className="num text-sm">{format.number(r.engagement)}</span>
          </div>
          <div className="an-bar-track" role="presentation">
            <div className="an-bar-fill" style={{ width: `${(r.engagement / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function AnalyticsPage() {
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');
  const [t, tc, tType, tNet, format] = await Promise.all([
    getTranslations('analytics'),
    getTranslations('common'),
    getTranslations('content.types'),
    getTranslations('channels.networks'),
    getFormatter(),
  ]);

  const [summary, insight, monitoring] = await Promise.all([
    getPerformanceSummary(s.campaignId),
    getLatestInsight(s.campaignId),
    getMonitoringResults(s.campaignId),
  ]);

  const hasData = summary.totals.postsCount > 0;

  // Raw platform / content-type keys → the same labels used elsewhere in the app.
  const platformLabel = (p: string) => (tNet.has(`${p}.name`) ? tNet(`${p}.name`) : p);
  const typeLabel = (type: string) => (tType.has(type) ? tType(type) : type.replace(/_/g, ' '));

  const tiles = [
    { label: t('tiles.reach'), value: format.number(summary.totals.reach), delta: pctDelta(summary.totals.reach, summary.priorTotals.reach) },
    { label: t('tiles.engagement'), value: format.number(summary.totals.engagement), delta: pctDelta(summary.totals.engagement, summary.priorTotals.engagement) },
    {
      label: t('tiles.engagementRate'),
      value: summary.totals.impressions > 0
        ? format.number(summary.totals.engagement / summary.totals.impressions, { style: 'percent', maximumFractionDigits: 1 })
        : '—',
      delta: null,
    },
    {
      label: t('tiles.videoWatchTime'),
      value: format.number(Math.round(summary.totals.videoAvgWatchSeconds), { style: 'unit', unit: 'second', unitDisplay: 'narrow' }),
      delta: null,
    },
  ];

  return (
    <AppFrame>
      <PageHeader eyebrow={t('eyebrow')} title={t('pageTitle')} description={t('description')}
        meta={<span className="badge badge-neutral">{t('last30Days')}</span>} />

      {!hasData ? (
        <EmptyState
          icon="analytics"
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <>
              <Link href="/content/new" className="btn btn-primary">{t('empty.cta')}</Link>
              <Link href="/channels" className="btn">{t('empty.ctaSecondary')}</Link>
            </>
          }
        />
      ) : (
        <div className="stack an-page">
          <div className="grid cols-4">
            {tiles.map(tile => (
              <div key={tile.label} className="card card-sm stat">
                <div className="stat-header"><span className="stat-label">{tile.label}</span></div>
                <div className="stat-value num">{tile.value}</div>
                <Delta value={tile.delta} t={t} />
              </div>
            ))}
          </div>

          <div className="grid cols-2">
            <section className="card" aria-labelledby="an-top-heading">
              <h2 id="an-top-heading">{t('topPerformingContent')}</h2>
              {summary.topContent.length === 0 ? (
                <p className="muted text-sm an-empty">{t('noContentThisPeriod')}</p>
              ) : (
                <ul className="an-top-list">
                  {summary.topContent.map(c => (
                    <li key={c.id}>
                      <Link href={`/content/${c.id}`} className="an-top-row">
                        <span className="an-top-text">
                          <span className="an-top-title">{c.title}</span>
                          <span className="subtle text-xs">{typeLabel(c.type)}</span>
                        </span>
                        <span className="num an-top-value">{format.number(c.engagement)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="an-platform-heading">
              <h2 id="an-platform-heading">{t('byPlatform')}</h2>
              <BarList
                rows={summary.byPlatform.map(r => ({ key: r.platform, label: platformLabel(r.platform), engagement: r.engagement }))}
                emptyLabel={t('barListEmpty')}
                format={format}
              />
            </section>
          </div>

          <div className="grid cols-2">
            <section className="card" aria-labelledby="an-type-heading">
              <h2 id="an-type-heading">{t('byContentType')}</h2>
              <BarList
                rows={summary.byContentType.map(r => ({ key: r.type, label: typeLabel(r.type), engagement: r.engagement }))}
                emptyLabel={t('barListEmpty')}
                format={format}
              />
            </section>

            <section className="card" aria-labelledby="an-opp-heading">
              <h2 id="an-opp-heading">{t('opponentActivityTitle')}</h2>
              <p className="muted text-sm an-prose">
                {t.rich('opponentActivityText', {
                  postsCount: format.number(summary.totals.postsCount),
                  // Same uncapped select as the dashboard tile: at the row cap this reads "1,000+".
                  mentionsCount: rowCountLabel(monitoring.length, format.number, c => tc('countCapped', { count: c })),
                  strong: (chunks) => <strong className="an-strong num">{chunks}</strong>,
                })}
              </p>
            </section>
          </div>

          <section className="card" aria-labelledby="an-insight-heading">
            <h2 id="an-insight-heading">{t('aiInsightTitle')}</h2>
            {insight ? (
              <div className="stack an-insight">
                {/* Model prose uses light markdown (**bold**, bullets); rendered as elements, never as HTML. */}
                <div className="an-prose an-md">{renderMarkdownLite(insight.summary)}</div>
                {insight.recommendations.length > 0 && (
                  <ul className="an-recs">
                    {insight.recommendations.map((r, i) => <li key={i}>{renderInlineMarkdown(r)}</li>)}
                  </ul>
                )}
                <p className="subtle text-xs">
                  {t('generatedOn', { date: format.dateTime(new Date(insight.generatedAt), { dateStyle: 'medium' }) })}
                </p>
              </div>
            ) : (
              <p className="muted text-sm an-empty">{t('noInsightYet')}</p>
            )}
          </section>
        </div>
      )}
    </AppFrame>
  );
}
