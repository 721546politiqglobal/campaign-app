import Link from 'next/link';
import { getAllAuditEntries } from '@/lib/data';

export default async function AdminAudit() {
  const entries = await getAllAuditEntries(200);

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Compliance</span>
          <h1>Audit log</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>
            {entries.length} entries · append-only
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Campaign</th>
              <th>Actor</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td style={{ fontSize: 11.5, color: 'var(--text-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{e.action}</td>
                <td>
                  <Link href={`/admin/campaigns/${e.campaignId}`}
                    style={{ color: 'var(--text-2)', fontSize: 12.5, textDecoration: 'none' }}>
                    {e.campaignName}
                  </Link>
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{e.actorName}</td>
                <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {e.entityType}{e.entityId ? <> · <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.entityId}</span></> : null}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 32, textAlign: 'center' }}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
