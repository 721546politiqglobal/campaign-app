'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MonitoringResult } from '@/lib/data';
import { dismissMonitoringAction } from '@/app/actions';

const CATEGORY_LABEL: Record<string, string> = {
  news: 'News', social: 'Social', blog: 'Blog', press_release: 'Press Release',
};

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
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const trendingIds = detectTrending(results);

  const filtered = results.filter(r => filter === 'all' || platformOf(r.source) === filter);

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
    { key: 'all',       label: 'All' },
    { key: 'twitter',   label: 'Twitter/X' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'youtube',   label: 'YouTube' },
    { key: 'facebook',  label: 'Facebook' },
    { key: 'news',      label: 'News' },
  ];

  return (
    <div>
      {/* Filter bar */}
      <div className="btnrow" style={{ marginBottom: 20 }}>
        {FILTERS.map(f => (
          <button key={f.key} className={`btn${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">No results for this filter.</p>
        </div>
      )}

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(result => {
          const trending = trendingIds.has(result.id);
          return (
            <div key={result.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{result.source}</span>
                  <span className="tag">{CATEGORY_LABEL[result.category] ?? result.category}</span>
                  {trending && <span className="tag trending">Trending</span>}
                </div>
                <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
                  {new Date(result.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>

              <p className={expanded.has(result.id) ? undefined : 'excerpt-clamp'}
                 style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 8px', color: 'var(--text)' }}>
                {result.excerpt}
              </p>
              {result.excerpt.length > 160 && (
                <button type="button" onClick={() => toggleExpanded(result.id)}
                  style={{ background: 'none', border: 'none', padding: 0, marginBottom: 14,
                           color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {expanded.has(result.id) ? 'Show less' : 'Show more'}
                </button>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={() => goToRebuttal(result)}>
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
