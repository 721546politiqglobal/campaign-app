import { notFound } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { GateStrip } from '@/components/GateStrip';
import { ActionPanel } from '@/components/ActionPanel';
import { requireSession } from '@/lib/session';
import { getContentItem, getApprovals, getDisclosuresForItem, getAuditEntries } from '@/lib/data';

export default async function ContentDetail({ params }: { params: { id: string } }) {
  const s = requireSession();
  const [item, approvals, discs, log] = await Promise.all([
    getContentItem(params.id),
    getApprovals(s.campaignId),
    getDisclosuresForItem(params.id),
    getAuditEntries(params.id),
  ]);
  if (!item) notFound();

  const approved = approvals.some(a => a.contentItemId === item.id && a.decision === 'approve');

  return (
    <AppFrame>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{item.isAiGenerated ? 'AI-generated' : 'Human-written'}</span>
          <h1>{item.title}</h1>
        </div>
        <div className="actions"><StatusPill status={item.status} /></div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <GateStrip approved={approved} disclosed={discs.length > 0} isAiGenerated={item.isAiGenerated} />
      </div>

      <div className="grid cols-2">
        <div>
          <div className="card">
            <h2>Body</h2>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{item.body}</p>
          </div>
          <div className="spacer-y" />
          <div className="card">
            <h2>Disclosures</h2>
            {discs.length === 0 && <p className="muted">None attached yet.</p>}
            {discs.map(d => (
              <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="eyebrow">{d.jurisdiction} &middot; {d.placement}</div>
                <div style={{ fontSize: 14 }}>{d.disclosureText}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <ActionPanel id={item.id} status={item.status} role={s.role}
            isAiGenerated={item.isAiGenerated} approved={approved} disclosed={discs.length > 0} />
          <div className="spacer-y" />
          <div className="card">
            <h2>Activity</h2>
            {log.length === 0 && <p className="muted">No activity yet.</p>}
            {log.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '6px 0', fontSize: 13 }}>
                <span className="mono">{new Date(a.createdAt).toLocaleTimeString()}</span>
                <span style={{ fontWeight: 600 }}>{a.action.replace(/_/g, ' ')}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Every action is written to an append-only audit log.
            </p>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
