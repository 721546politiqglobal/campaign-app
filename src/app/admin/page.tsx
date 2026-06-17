import Link from 'next/link';
import { getSystemStats, getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from './actions';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SpendBar({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min((spent / cap) * 100, 100) : 0;
  const over = spent > cap;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-hover)', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: over ? 'var(--bad)' : pct > 80 ? 'var(--warn)' : 'var(--accent)',
          transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 11, color: over ? 'var(--bad)' : 'var(--text-3)', minWidth: 36, textAlign: 'right' }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export default async function AdminOverview() {
  const [stats, campaigns] = await Promise.all([getSystemStats(), getAllCampaigns()]);

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Overview</h1>
        </div>
      </div>

      {/* Stat cards */}
      <div className="admin-stat-grid">
        <div className="card">
          <div className="stat-header">
            <span className="stat-label">Campaigns</span>
            <svg className="stat-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M3 16V8L10 3L17 8V16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <rect x="7" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </div>
          <div className="stat-value">{stats.campaignCount}</div>
        </div>
        <div className="card">
          <div className="stat-header">
            <span className="stat-label">Users</span>
            <svg className="stat-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M2 17C2 13.686 4.686 11 8 11C11.314 11 14 13.686 14 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M15 9C16.657 9 18 10.343 18 12V17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <circle cx="15.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
          </div>
          <div className="stat-value">{stats.userCount}</div>
        </div>
        <div className="card">
          <div className="stat-header">
            <span className="stat-label">Content items</span>
            <svg className="stat-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
              <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="6" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="stat-value">{stats.contentCount}</div>
        </div>
        <div className="card">
          <div className="stat-header">
            <span className="stat-label">Awaiting review</span>
            <svg className="stat-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 6V10.5L13 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="stat-value" style={{ color: stats.inReviewCount > 0 ? 'var(--warn)' : undefined }}>
            {stats.inReviewCount}
          </div>
        </div>
      </div>

      {/* Campaigns table */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>All campaigns</h2>
        <button
          className="btn primary"
          style={{ fontSize: 13 }}
          onClick={undefined}
          form="create-campaign-form"
          type="button"
          formAction={undefined}
        >
          {/* Handled by modal below */}
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Jurisdictions</th>
              <th>Users</th>
              <th>Content</th>
              <th>Monthly spend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map(c => (
              <tr key={c.id} className="row" onClick={undefined}>
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
                      <span key={j} className="pill" style={{ fontSize: 10 }}>{j}</span>
                    ))}
                  </div>
                </td>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.userCount}</td>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.contentCount}</td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {fmt(c.monthlySpendCents)} <span style={{ color: 'var(--text-3)' }}>/ {fmt(c.monthlyCostCapCents)}</span>
                  </div>
                  <SpendBar spent={c.monthlySpendCents} cap={c.monthlyCostCapCents} />
                </td>
                <td>
                  <Link href={`/admin/campaigns/${c.id}`} className="btn" style={{ fontSize: 12, padding: '5px 10px' }}>
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create campaign form */}
      <div className="card" style={{ maxWidth: 540 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">New campaign</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>Create campaign</h2>
        </div>
        <form action={createCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Campaign name</label>
            <input name="name" className="input" placeholder="e.g. Smith for Governor" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Monthly cap (USD)</label>
              <input name="cap" type="number" className="input" defaultValue="1000" min="0" />
            </div>
            <div>
              <label className="field-label">Jurisdictions</label>
              <input name="jurisdictions" className="input" placeholder="US-FEDERAL, US-CA" defaultValue="US-FEDERAL" />
            </div>
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Create campaign</button>
        </form>
      </div>
    </div>
  );
}
