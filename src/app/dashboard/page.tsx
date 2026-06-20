import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { GateStrip } from '@/components/GateStrip';
import { requireSession } from '@/lib/session';
import {
  getContentItems, getApprovals, getDisclosures,
  getMonitoringResults, getMonthlySpend, getCampaign, getDisclosureRules,
} from '@/lib/data';

export default async function Dashboard() {
  const s = requireSession();
  if (s.role === 'super_admin') redirect('/admin');
  const [items, approvals, disclosures, monitoring, spend, campaign, rules] = await Promise.all([
    getContentItems(s.campaignId),
    getApprovals(s.campaignId),
    getDisclosures(s.campaignId),
    getMonitoringResults(s.campaignId),
    getMonthlySpend(s.campaignId),
    getCampaign(s.campaignId),
    getDisclosureRules(),
  ]);

  const approved = (id: string) => approvals.some(a => a.contentItemId === id && a.decision === 'approve');
  const disclosed = (id: string) => disclosures.some(d => d.contentItemId === id);

  const queue = items.filter(c => c.status === 'in_review');
  const live = items.filter(c => c.status === 'published').length;
  const scheduled = items.filter(c => c.status === 'scheduled').length;
  const cap = campaign?.monthlyCostCapCents ?? 0;
  const needsLegal = rules.filter(r => r.needsLegalReview).map(r => r.jurisdiction);

  return (
    <AppFrame>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>Today</h1>
        </div>
        <div className="actions">
          <Link className="btn primary" href="/content/new">New content</Link>
        </div>
      </div>

      {needsLegal.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 18 }}>
          <div>
            <div className="t">Disclosure rules need legal review</div>
            <div className="b">
              Placeholder wording is in place for {needsLegal.join(', ')}. Confirm the exact required
              text and pre-election timing with counsel before publishing AI content.
            </div>
          </div>
        </div>
      )}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="stat-header">
            <div className="stat-icon">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                <line x1="7.5" y1="4.5" x2="7.5" y2="7.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <circle cx="7.5" cy="9.8" r="0.7" fill="currentColor"/>
              </svg>
            </div>
          </div>
          <div className="n">{queue.length}</div>
          <div className="l">Awaiting review</div>
        </div>
        <div className="card stat">
          <div className="stat-header">
            <div className="stat-icon">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="1.5" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                <line x1="1.5" y1="5.5" x2="13.5" y2="5.5" stroke="currentColor" strokeWidth="1.3"/>
                <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          <div className="n">{scheduled}</div>
          <div className="l">Scheduled</div>
        </div>
        <div className="card stat">
          <div className="stat-header">
            <div className="stat-icon">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M4.5 7.5L6.5 9.5L10.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          <div className="n">{live}</div>
          <div className="l">Published</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Needs attention</h2>
          {queue.length === 0 && <p className="muted">Nothing waiting for review.</p>}
          {queue.map(c => (
            <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Link className="linkcell" href={`/content/${c.id}`}>{c.title}</Link>
                <StatusPill status={c.status} />
              </div>
              <GateStrip approved={approved(c.id)} disclosed={disclosed(c.id)} isAiGenerated={c.isAiGenerated} />
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Opponent monitoring</h2>
          {monitoring.slice(0, 3).map(m => (
            <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="eyebrow">{m.source}</div>
              <div style={{ fontSize: 14 }}>{m.excerpt}</div>
            </div>
          ))}
          <div className="spacer-y" />
          <Link className="btn" href="/monitoring">Open monitoring</Link>
        </div>
      </div>

      <div className="subtle-divider" />
      <div className="card">
        <h2>This month&rsquo;s spend</h2>
        <p>
          <span style={{ fontSize: 22, fontWeight: 600 }}>${(spend / 100).toFixed(2)}</span>
          <span className="muted"> of ${(cap / 100).toFixed(2)} cap</span>
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Paid actions (video, voice, AI drafting) count against the campaign&rsquo;s cap. Adjust in Settings.
        </p>
      </div>
    </AppFrame>
  );
}
