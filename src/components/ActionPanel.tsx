'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  submitAction, decideAction, attachDisclosureAction, scheduleAction, publishAction,
} from '@/app/actions';
import { Platform, ContentStatus } from '@/domain/types';

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'];

export function ActionPanel(props: {
  id: string; status: ContentStatus; role: string;
  isAiGenerated: boolean; approved: boolean; disclosed: boolean;
}) {
  const { id, status, isAiGenerated, approved, disclosed } = props;
  const router = useRouter();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram', 'facebook']);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error || 'Something went wrong.');
    else router.refresh();
  }

  const toggle = (p: Platform) =>
    setPlatforms(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p]);

  return (
    <div className="card">
      <h2>Actions</h2>

      {status === 'draft' && (
        <button className="btn primary" disabled={busy} onClick={() => run(() => submitAction(id))}>
          Submit for review
        </button>
      )}

      {status === 'in_review' && (
        <>
          <label className="field">
            <span className="cap">Note (optional)</span>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason or context" />
          </label>
          <div className="btnrow">
            <button className="btn primary" disabled={busy} onClick={() => run(() => decideAction(id, 'approve', note))}>Approve</button>
            <button className="btn danger" disabled={busy} onClick={() => run(() => decideAction(id, 'reject', note))}>Reject</button>
          </div>
        </>
      )}

      {status === 'approved' && (
        <>
          {isAiGenerated && !disclosed && (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                This is AI-generated, so a disclosure must be attached before it can be scheduled.
              </p>
              <button className="btn" disabled={busy} onClick={() => run(() => attachDisclosureAction(id))}>
                Attach required disclosure
              </button>
              <div className="spacer-y" />
            </>
          )}
          <button className="btn primary" disabled={busy} onClick={() => run(() => scheduleAction(id))}>
            Schedule
          </button>
        </>
      )}

      {status === 'scheduled' && (
        <>
          <span className="cap">Publish to</span>
          <div className="btnrow" style={{ margin: '8px 0 14px' }}>
            {PLATFORMS.map(p => (
              <label key={p} className="checkrow">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} /> {p}
              </label>
            ))}
          </div>
          <button className="btn primary" disabled={busy || platforms.length === 0}
            onClick={() => run(() => publishAction(id, platforms))}>
            Publish now
          </button>
        </>
      )}

      {status === 'published' && <p className="muted">Published. The disclosure travels with the post on every platform.</p>}
      {status === 'rejected' && <p className="muted">Rejected. See the activity log below for the reason.</p>}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
