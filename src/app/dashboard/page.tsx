import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/icons';
import { requireSession } from '@/lib/session';
import { getContentItems, getMonitoringCount, getMonitoringResults, getScheduledToday } from '@/lib/data';
import type { Platform } from '@/domain/types';

const ATTENTION_LIMIT = 6;
const PULSE_LIMIT = 4;
const PLATFORM_KEYS: Platform[] = ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'];

export default async function Dashboard() {
  const [t, tc, tType, tNet, format] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('common'),
    getTranslations('content.types'),
    getTranslations('channels.networks'),
    getFormatter(),
  ]);
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [items, monitoring, monitoringCount, todayScheduled] = await Promise.all([
    getContentItems(s.campaignId),
    getMonitoringResults(s.campaignId),
    getMonitoringCount(s.campaignId),
    getScheduledToday(s.campaignId),
  ]);

  const needsAttention = items
    .filter(c => c.status === 'draft' || c.status === 'in_review')
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  const count = (st: string) => items.filter(c => c.status === st).length;
  const inReviewN = count('in_review');
  const scheduledN = count('scheduled');
  const publishedN = count('published');
  const signalsLabel = format.number(monitoringCount);

  const tiles = [
    { label: t('tiles.needsReview'), value: format.number(inReviewN), icon: 'inbox', tone: inReviewN > 0 ? 'warn' : '', href: '/content?status=in_review', hint: t('tiles.inReviewWaiting', { count: inReviewN }) },
    { label: t('tiles.scheduled'), value: format.number(scheduledN), icon: 'calendar', tone: 'purple', href: '/content?status=scheduled', hint: t('tiles.queuedToPublish') },
    { label: t('tiles.published'), value: format.number(publishedN), icon: 'send', tone: 'ok', href: '/content?status=published', hint: t('tiles.liveOnSocials') },
    { label: t('tiles.oppSignals'), value: signalsLabel, icon: 'monitoring', tone: 'info', href: '/monitoring', hint: t('tiles.inTheFeed') },
  ] as const;

  const now = new Date();
  const networkName = (p: string) =>
    (PLATFORM_KEYS as string[]).includes(p) ? tNet(`${p}.name`) : p;

  return (
    <AppFrame>
      <PageHeader
        eyebrow={t('overview')}
        title={t('today')}
        description={t('description')}
        actions={
          <>
            <Link className="btn" href="/monitoring">{t('opponentFeed')}</Link>
            <Link className="btn btn-primary" href="/content/new"><Icon name="plus" size={16} />{t('newContent')}</Link>
          </>
        }
      />

      <div className="stack dash-stack">
        {/* KPI tiles */}
        <div className="grid cols-4">
          {tiles.map(tile => (
            <Link key={tile.href} href={tile.href} className={`card card-sm stat dash-stat${tile.tone ? ` is-${tile.tone}` : ''}`}>
              <div className="stat-header">
                <span className="stat-label">{tile.label}</span>
                <span className="stat-icon"><Icon name={tile.icon} size={16} /></span>
              </div>
              <div className="stat-value num">{tile.value}</div>
              <div className="stat-hint">{tile.hint}</div>
            </Link>
          ))}
        </div>

        {/* Today's schedule strip */}
        {todayScheduled.length > 0 && (
          <section aria-labelledby="dash-today">
            <h2 id="dash-today" className="eyebrow dash-section-label">{t('goingOutToday')}</h2>
            <div className="dash-strip">
              {todayScheduled.map(item => (
                <Link key={item.id} href={`/content/${item.id}`} className="card card-sm interactive dash-strip-card">
                  <div className="dash-strip-platforms">
                    {item.platforms.slice(0, 3).map(p => (
                      <span key={p} className="badge badge-sm badge-accent">{networkName(p)}</span>
                    ))}
                  </div>
                  <div className="dash-strip-title">{item.title}</div>
                  <div className="dash-strip-time num">
                    <Icon name="clock" size={13} />
                    {format.dateTime(new Date(item.scheduledAt), { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="dash-grid">
          {/* Needs attention */}
          <section className="card card-sectioned" aria-labelledby="dash-attention">
            <div className="card-header">
              <div className="card-header-text">
                <h2 id="dash-attention">{t('needsAttention')}</h2>
              </div>
              {needsAttention.length > 0 && (
                <span className="badge badge-neutral badge-sm num">{format.number(needsAttention.length)}</span>
              )}
            </div>
            {needsAttention.length === 0 ? (
              <EmptyState
                plain
                icon="success"
                title={t('emptyAttention.title')}
                description={t('emptyAttention.description')}
                action={<Link className="btn btn-primary" href="/content/new">{t('createNewContent')}</Link>}
              />
            ) : (
              <ul className="dash-list">
                {needsAttention.slice(0, ATTENTION_LIMIT).map(c => (
                  <li key={c.id}>
                    <Link href={`/content/${c.id}`} className="dash-list-row row-hover">
                      <span className="dash-list-main">
                        <span className="dash-list-title">{c.title}</span>
                        <span className="dash-list-meta">
                          <span>{tType(c.type)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{t('updatedOn', { date: format.relativeTime(new Date(c.updatedAt), now) })}</span>
                        </span>
                      </span>
                      <StatusPill status={c.status} size="sm" />
                    </Link>
                  </li>
                ))}
                {needsAttention.length > ATTENTION_LIMIT && (
                  <li className="dash-list-more">
                    <Link className="link" href="/content?status=in_review">
                      {t('moreItems', { count: needsAttention.length - ATTENTION_LIMIT })}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </section>

          {/* Opponent pulse */}
          <section className="card card-sectioned" aria-labelledby="dash-pulse">
            <div className="card-header">
              <div className="card-header-text">
                <h2 id="dash-pulse">{t('opponentPulse')}</h2>
              </div>
              {monitoring.length > 0 && <span className="badge badge-sm badge-info badge-dot">{t('live')}</span>}
            </div>
            {monitoring.length === 0 ? (
              <EmptyState
                plain
                icon="monitoring"
                title={t('opponentEmpty.title')}
                description={t('opponentEmpty.description')}
              />
            ) : (
              <ul className="dash-pulse">
                {monitoring.slice(0, PULSE_LIMIT).map(m => (
                  <li key={m.id} className="dash-pulse-item">
                    <div className="dash-pulse-head">
                      <span className={`dash-cred dash-cred-${m.credibility}`} title={t(`credibility.${m.credibility}`)}>
                        <span className="sr-only">{t(`credibility.${m.credibility}`)}</span>
                      </span>
                      <span className="dash-pulse-source">{m.source}</span>
                      {m.opponent && <span className="dash-pulse-opponent">{m.opponent}</span>}
                      <span className="dash-pulse-time">{format.relativeTime(new Date(m.capturedAt), now)}</span>
                    </div>
                    <p className="dash-pulse-excerpt excerpt-clamp">{m.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="card-footer">
              <Link className="btn btn-ghost btn-sm" href="/monitoring">
                {t('seeFullFeed')}<Icon name="arrow-right" size={14} />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </AppFrame>
  );
}
