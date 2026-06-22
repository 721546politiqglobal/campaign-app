import Link from 'next/link';
import { getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from '../actions';

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

export default async function CampaignsPage() {
  const campaigns = await getAllCampaigns();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Campaigns</h1>
        </div>
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
                      <span key={j} className="pill" style={{ fontSize: 10 }}>{j}</span>
                    ))}
                  </div>
                </td>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.userCount}</td>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.contentCount}</td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {fmt(c.monthlySpendCents)}{' '}
                    <span style={{ color: 'var(--text-3)' }}>/ {fmt(c.monthlyCostCapCents)}</span>
                  </div>
                  <SpendBar spent={c.monthlySpendCents} cap={c.monthlyCostCapCents} />
                </td>
                <td>
                  <Link
                    href={`/admin/campaigns/${c.id}`}
                    className="btn"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 24 }}>No campaigns yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Monthly cap (USD)</label>
              <input name="cap" type="number" className="input" defaultValue="1000" min="0" />
            </div>
            <div>
              <label className="field-label">Jurisdictions</label>
              <input
                name="jurisdictions"
                className="input"
                placeholder="US-FEDERAL, US-CA"
                defaultValue="US-FEDERAL"
              />
            </div>
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Create campaign</button>
        </form>
      </div>
    </div>
  );
}
