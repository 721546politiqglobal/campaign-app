import { getSystemStats, getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from './actions';
import { CampaignsTable } from '@/components/CampaignsTable';

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
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>All campaigns</h2>

      <CampaignsTable campaigns={campaigns} />

      {/* Create campaign form */}
      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">New campaign</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>Create campaign</h2>
        </div>
        <form action={createCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Campaign name</label>
            <input name="name" className="input" placeholder="e.g. Smith for Governor" required />
          </div>
          <div>
            <label className="field-label">Jurisdictions</label>
            <input name="jurisdictions" className="input" placeholder="US-FEDERAL, US-CA" defaultValue="US-FEDERAL" />
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Create campaign</button>
        </form>
      </div>
    </div>
  );
}
