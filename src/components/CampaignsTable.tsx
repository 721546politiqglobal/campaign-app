'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CampaignWithStats } from '@/lib/data';
import { filterCampaigns, isCampaignActive, type CampaignStatusFilter } from '@/lib/campaign-filters';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithStats[] }) {
  const t = useTranslations('admin.campaignsTable');
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const STATUS_FILTERS: { key: CampaignStatusFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'active', label: t('active') },
    { key: 'inactive', label: t('inactive') },
  ];

  const allTags = [...new Set(campaigns.flatMap(c => c.tags))].sort();
  const filtered = filterCampaigns(campaigns, statusFilter, tagFilter);

  function toggleTag(tag: string) {
    setTagFilter(prev => prev.includes(tag) ? prev.filter(existingTag => existingTag !== tag) : [...prev, tag]);
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
              <th>{t('colCampaign')}</th>
              <th>{t('colJurisdictions')}</th>
              <th>{t('colTags')}</th>
              <th>{t('colStatus')}</th>
              <th>{t('colUsers')}</th>
              <th>{t('colContent')}</th>
              <th>{t('colSpend')}</th>
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
                        {t('inReviewCount', { count: c.inReviewCount })} ·{' '}
                      </span>
                    )}
                    {t('totalCount', { count: c.contentCount })}
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
                    {c.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`tag ${isCampaignActive(c.subscriptionStatus) ? 'cred-high' : 'cred-low'}`}>
                    {isCampaignActive(c.subscriptionStatus) ? t('active') : t('inactive')}
                  </span>
                </td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.userCount}</td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.contentCount}</td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{fmt(c.monthlySpendCents)}</td>
                <td>
                  <Link href={`/admin/campaigns/${c.id}`} className="btn" style={{ fontSize: 12, padding: '5px 10px' }}>
                    {t('manage')}
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 24 }}>
                  {campaigns.length === 0 ? t('emptyNone') : t('emptyFiltered')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
