'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CampaignWithStats } from '@/lib/data';
import { filterCampaigns, isCampaignActive, type CampaignStatusFilter } from '@/lib/campaign-filters';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_FILTERS: { key: CampaignStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithStats[] }) {
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const allTags = [...new Set(campaigns.flatMap(c => c.tags))].sort();
  const filtered = filterCampaigns(campaigns, statusFilter, tagFilter);

  function toggleTag(tag: string) {
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  return (
    <div>
      <div className="btnrow" style={{ marginBottom: 12 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f.key} className={`btn${statusFilter === f.key ? ' active' : ''}`}
            onClick={() => setStatusFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="btnrow" style={{ marginBottom: 20 }}>
          {allTags.map(tag => (
            <button key={tag} className={`btn${tagFilter.includes(tag) ? ' active' : ''}`}
              onClick={() => toggleTag(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Jurisdictions</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Users</th>
              <th>Content</th>
              <th>Spend this period</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="row">
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13.5 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {c.inReviewCount > 0 && (
                      <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        {c.inReviewCount} in review ·{' '}
                      </span>
                    )}
                    {c.contentCount} total
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.jurisdictions.map(j => (
                      <span key={j} className="tag">{j}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.tags.map(t => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`tag ${isCampaignActive(c.subscriptionStatus) ? 'cred-high' : 'cred-low'}`}>
                    {isCampaignActive(c.subscriptionStatus) ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.userCount}</td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.contentCount}</td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{fmt(c.monthlySpendCents)}</td>
                <td>
                  <Link href={`/admin/campaigns/${c.id}`} className="btn" style={{ fontSize: 12, padding: '5px 10px' }}>
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 24 }}>
                  {campaigns.length === 0 ? 'No campaigns yet.' : 'No campaigns match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
