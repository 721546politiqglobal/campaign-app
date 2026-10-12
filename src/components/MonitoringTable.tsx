'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { MonitoringResult } from '@/lib/data';
import { dismissMonitoringAction, restoreMonitoringAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { ExternalIcon, SparklesIcon } from '@/components/icons';
import { excerptForBrief } from '@/app/monitoring/validation';

// Sources are free text (the manual-add form lets a user type anything), so
// only the exact strings our own integrations write get their own tab —
// everything else (news wires, blogs, manual entries) buckets into 'news'.
type Platform = 'twitter' | 'instagram' | 'youtube' | 'facebook' | 'news';
const PLATFORM_LABEL: Record<string, Platform> = {
  'Twitter/X': 'twitter', 'Instagram': 'instagram', 'YouTube': 'youtube', 'Facebook': 'facebook',
};
function platformOf(source: string): Platform {
  return PLATFORM_LABEL[source] ?? 'news';
}

type Filter = 'all' | Platform;
const FILTER_KEYS: Filter[] = ['all', 'twitter', 'instagram', 'youtube', 'facebook', 'news'];
const ALL_OPPONENTS = '__all__';
const CRED_TONE: Record<MonitoringResult['credibility'], BadgeTone> = { high: 'ok', medium: 'neutral', low: 'bad' };
const CATEGORY_KEY: Record<MonitoringResult['category'], string> = {
  news: 'news', social: 'social', blog: 'blog', press_release: 'pressRelease',
};

function detectTrending(results: MonitoringResult[]): Set<string> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const recent = results.filter(r => r.capturedAt > sixHoursAgo);

  const domainCount = new Map<string, string[]>();
  for (const r of recent) {
    try {
      const domain = new URL(r.url).hostname.replace(/^www\./, '');
      if (!domainCount.has(domain)) domainCount.set(domain, []);
      domainCount.get(domain)!.push(r.id);
    } catch { /* skip malformed URLs */ }
  }

  const trendingIds = new Set<string>();
  for (const ids of domainCount.values()) {
    if (ids.length >= 3) ids.forEach(id => trendingIds.add(id));
  }
  return trendingIds;
}

// The `?brief=&type=&respondTo=` contract /content/new understands: the
// editor is pre-filled with the brief, and the server loads the full story by
// id (scoped to the campaign) for the AI.
const RESPONSE_TYPES = ['social_post', 'talking_points', 'press_release'] as const;
function rebuttalHref(brief: string, storyId: string, type: (typeof RESPONSE_TYPES)[number]): string {
  const params = new URLSearchParams({ brief, type, respondTo: storyId });
  return `/content/new?${params.toString()}`;
}

const TRIAGE_TONE: Record<MonitoringResult['triageLevel'], BadgeTone | null> = {
  attack: 'bad', opponent_statement: 'warn', relevant: null, noise: 'neutral',
};

export function MonitoringTable({ results, total }: { results: MonitoringResult[]; total?: number }) {
  const t = useTranslations('monitoring');
  const format = useFormatter();
  const { toast } = useToast();
  const [items, setItems] = useState<MonitoringResult[]>(results);
  const [filter, setFilter] = useState<Filter>('all');
  const [opponent, setOpponent] = useState<string>(ALL_OPPONENTS);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [showNoise, setShowNoise] = useState(false);

  // The server list is the source of truth whenever the route re-renders
  // (manual add, navigation); optimistic edits live in between.
  useEffect(() => { setItems(results); }, [results]);

  const opponents = useMemo(
    () => Array.from(new Set(items.map(r => r.opponent).filter((o): o is string => !!o))).sort(),
    [items],
  );
  const trendingIds = useMemo(() => detectTrending(items), [items]);

  const isPriority = (r: MonitoringResult) => r.triageLevel === 'attack' || r.triageLevel === 'opponent_statement';
  const matching = items.filter(r =>
    (filter === 'all' || platformOf(r.source) === filter) &&
    (opponent === ALL_OPPONENTS || r.opponent === opponent) &&
    (!priorityOnly || isPriority(r)),
  );
  // AI-triaged "noise" stays out of the way unless asked for.
  const noiseCount = matching.filter(r => r.triageLevel === 'noise').length;
  const filtered = showNoise ? matching : matching.filter(r => r.triageLevel !== 'noise');
  const filtersActive = filter !== 'all' || opponent !== ALL_OPPONENTS || priorityOnly;
  const clearFilters = () => { setFilter('all'); setOpponent(ALL_OPPONENTS); setPriorityOnly(false); };

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function restore(item: MonitoringResult, index: number) {
    try {
      const r = await restoreMonitoringAction(item.id);
      if (!r.ok) { toast(r.error, 'error'); return; }
      setItems(prev => {
        if (prev.some(p => p.id === item.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
      toast(t('restored'));
    } catch (e) {
      console.error('[monitoring] restore failed', e);
      toast(t('genericError'), 'error');
    }
  }

  async function handleDismiss(item: MonitoringResult) {
    const index = items.findIndex(p => p.id === item.id);
    setDismissing(item.id);
    // Optimistic: drop it now, put it back if the server disagrees.
    setItems(prev => prev.filter(p => p.id !== item.id));
    try {
      const r = await dismissMonitoringAction(item.id);
      if (!r.ok) {
        setItems(prev => { const next = [...prev]; next.splice(Math.min(index, next.length), 0, item); return next; });
        toast(r.error, 'error');
        return;
      }
      toast(t('dismissed'), 'info', { duration: 8000, action: { label: t('undo'), onClick: () => { void restore(item, index); } } });
    } catch (e) {
      console.error('[monitoring] dismiss failed', e);
      setItems(prev => { const next = [...prev]; next.splice(Math.min(index, next.length), 0, item); return next; });
      toast(t('genericError'), 'error');
    } finally {
      setDismissing(null);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="monitoring"
        title={t('empty.title')}
        description={t('empty.description')}
        action={<Link href="/settings" className="btn">{t('empty.cta')}</Link>}
      />
    );
  }

  return (
    <div className="stack">
      <div className="mon-toolbar">
        <div className="segmented segmented-sm" role="group" aria-label={t('filters.all')}>
          {FILTER_KEYS.map(key => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {t(`filters.${key}`)}
            </button>
          ))}
        </div>
        <div className="mon-toolbar-right">
          <button type="button" className={`chip${priorityOnly ? ' on' : ''}`} aria-pressed={priorityOnly}
            onClick={() => setPriorityOnly(v => !v)}>
            {t('priorityOnly')}
          </button>
          {opponents.length > 0 && (
            <Field label={t('opponentFilter')} className="mon-opponent-field">
              {(p) => (
                <select {...p} className="input input-sm" value={opponent} onChange={e => setOpponent(e.target.value)}>
                  <option value={ALL_OPPONENTS}>{t('allOpponents')}</option>
                  {opponents.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </Field>
          )}
          <span className="subtle text-sm num" aria-live="polite">{t('countLabel', { count: filtered.length })}</span>
        </div>
      </div>
      {total !== undefined && total > results.length && (
        <p className="subtle text-sm">{t('showingLatest', { shown: results.length, total })}</p>
      )}
      {noiseCount > 0 && (
        <button type="button" className="link text-sm mon-noise-toggle" aria-pressed={showNoise} onClick={() => setShowNoise(v => !v)}>
          {showNoise ? t('hideNoise') : t('showNoise', { count: noiseCount })}
        </button>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="filter"
          title={t('empty.filteredTitle')}
          description={t('empty.filteredDescription')}
          action={<button type="button" className="btn" onClick={clearFilters}>{t('empty.clearFilters')}</button>}
        />
      ) : (
        <ul className="mon-list">
          {filtered.map(result => {
            const isExpanded = expanded.has(result.id);
            const brief = t('respondToStory', { source: result.source, excerpt: excerptForBrief(result.excerpt) });
            return (
              <li key={result.id} className="card mon-card">
                <div className="mon-card-head">
                  <div className="mon-card-meta">
                    {TRIAGE_TONE[result.triageLevel] && (
                      <Badge tone={TRIAGE_TONE[result.triageLevel]!} size="sm">{t(`triage.${result.triageLevel}`)}</Badge>
                    )}
                    <span className="mon-source">{result.source}</span>
                    {result.opponent && <span className="subtle text-xs">{result.opponent}</span>}
                    <Badge tone="neutral" size="sm">{t(`category.${CATEGORY_KEY[result.category]}`)}</Badge>
                    <Badge tone={CRED_TONE[result.credibility]} size="sm" dot>{t(`credibility.${result.credibility}`)}</Badge>
                    {trendingIds.has(result.id) && <Badge tone="accent" size="sm">{t('trending')}</Badge>}
                  </div>
                  <time className="mon-time num" dateTime={result.capturedAt}>
                    {format.dateTime(new Date(result.capturedAt), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </time>
                </div>

                {result.triageReason && result.triageLevel !== 'relevant' && (
                  <p className="mon-why text-sm"><strong>{t('whyItMatters')}</strong> {result.triageReason}</p>
                )}
                <p className={`mon-excerpt${isExpanded ? '' : ' excerpt-clamp'}`}>{result.excerpt}</p>
                {result.excerpt.length > 160 && (
                  <button type="button" className="mon-more link" aria-expanded={isExpanded} onClick={() => toggleExpanded(result.id)}>
                    {isExpanded ? t('showLess') : t('showMore')}
                  </button>
                )}

                <div className="mon-card-actions">
                  <Link href={rebuttalHref(brief, result.id, 'social_post')} className="btn btn-primary btn-sm">
                    <SparklesIcon size={14} />
                    {t('draftRebuttal')}
                  </Link>
                  <Link href={rebuttalHref(brief, result.id, 'talking_points')} className="btn btn-sm">{t('respondAs.talking_points')}</Link>
                  <Link href={rebuttalHref(brief, result.id, 'press_release')} className="btn btn-sm">{t('respondAs.press_release')}</Link>
                  {result.url && (
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                      {t('readArticle')}
                      <ExternalIcon size={14} />
                    </a>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm mon-dismiss"
                    disabled={dismissing === result.id} aria-busy={dismissing === result.id}
                    onClick={() => handleDismiss(result)}>
                    {dismissing === result.id ? t('dismissing') : t('dismiss')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {filtersActive && filtered.length > 0 && items.length !== filtered.length && (
        <div className="mon-filter-note subtle text-xs">
          <button type="button" className="link mon-clear" onClick={clearFilters}>
            {t('empty.clearFilters')}
          </button>
        </div>
      )}
    </div>
  );
}
