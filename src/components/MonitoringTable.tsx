'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MonitoringResult } from '@/lib/data';
import { dismissMonitoringAction } from '@/app/actions';

const CREDIBILITY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: '● High credibility',   color: '#16a34a', bg: 'color-mix(in srgb, #16a34a 12%, transparent)' },
  medium: { label: '● Medium credibility', color: '#d97706', bg: 'color-mix(in srgb, #d97706 12%, transparent)' },
  low:    { label: '● Low credibility',    color: '#dc2626', bg: 'color-mix(in srgb, #dc2626 12%, transparent)' },
};

const CATEGORY_LABEL: Record<string, string> = {
  news: 'News', social: 'Social', blog: 'Blog', press_release: 'Press Release',
};

type Filter = 'all' | 'high' | 'medium' | 'low' | 'news' | 'social';

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

export function MonitoringTable({ results }: { results: MonitoringResult[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [warnId, setWarnId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const trendingIds = detectTrending(results);

  const filtered = results.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'high' || filter === 'medium' || filter === 'low') return r.credibility === filter;
    if (filter === 'news' || filter === 'social') return r.category === filter;
    return true;
  });

  function handleRebuttal(result: MonitoringResult) {
    if (result.credibility === 'low') {
      setWarnId(result.id);
      return;
    }
    goToRebuttal(result);
  }

  function goToRebuttal(result: MonitoringResult) {
    const brief = encodeURIComponent(
      `Respond to this story from ${result.source}: "${result.excerpt.slice(0, 200)}"`
    );
    router.push(`/content/new?brief=${brief}&type=social_post`);
  }

  async function handleDismiss(id: string) {
    setDismissing(id);
    await dismissMonitoringAction(id);
    setDismissing(null);
    router.refresh();
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',    label: 'All' },
    { key: 'high',   label: '🟢 High' },
    { key: 'medium', label: '🟡 Medium' },
    { key: 'low',    label: '🔴 Low' },
    { key: 'news',   label: 'News' },
    { key: 'social', label: 'Social' },
  ];

  return (
    <div>
      {/* Filter bar */}
      <div className="btnrow" style={{ marginBottom: 20 }}>
        {FILTERS.map(f => (
          <button key={f.key} className="btn"
            onClick={() => setFilter(f.key)}
            style={filter === f.key ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Low-credibility rebuttal warning */}
      {warnId && (() => {
        const result = results.find(r => r.id === warnId)!;
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}>
            <div className="card" style={{ maxWidth: 480, width: '90%' }}>
              <h2 style={{ marginBottom: 10 }}>⚠️ Low-credibility source</h2>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                <strong>{result.source}</strong> has a low credibility rating.
                Responding publicly may give this story more attention than it deserves.
                Many campaigns choose to monitor and ignore low-credibility sources.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => setWarnId(null)}>
                  Ignore this story
                </button>
                <button className="btn primary" style={{ flex: 1 }}
                  onClick={() => { setWarnId(null); goToRebuttal(result); }}>
                  Draft rebuttal anyway →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">No results for this filter.</p>
        </div>
      )}

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(result => {
          const badge = CREDIBILITY_BADGE[result.credibility] ?? CREDIBILITY_BADGE.medium;
          const trending = trendingIds.has(result.id);
          return (
            <div key={result.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{result.source}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 20,
                    color: badge.color, background: badge.bg, fontWeight: 600,
                  }}>{badge.label}</span>
                  <span className="pill" style={{ fontSize: 10 }}>{CATEGORY_LABEL[result.category] ?? result.category}</span>
                  {trending && (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: 'color-mix(in srgb, var(--warn) 15%, transparent)',
                      color: 'var(--warn)', fontWeight: 700,
                    }}>🔥 Trending</span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(result.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>

              <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 14px', color: 'var(--text)' }}>
                {result.excerpt}
              </p>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={() => handleRebuttal(result)}>
                  Draft rebuttal
                </button>
                {result.url && (
                  <a href={result.url} target="_blank" rel="noopener noreferrer"
                    className="btn" style={{ fontSize: 12, padding: '6px 14px' }}>
                    Read article ↗
                  </a>
                )}
                <button className="btn" style={{ fontSize: 12, padding: '6px 14px', marginLeft: 'auto', color: 'var(--text-3)' }}
                  disabled={dismissing === result.id}
                  onClick={() => handleDismiss(result.id)}>
                  {dismissing === result.id ? 'Dismissing…' : 'Dismiss'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
