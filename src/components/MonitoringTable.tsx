'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MonitoringResult } from '@/lib/data';
import { generateFromMonitoringAction } from '@/app/actions';

const CONTENT_TYPES = [
  { value: 'social_post', label: 'Social post' },
  { value: 'reel', label: 'Reel script' },
  { value: 'press_release', label: 'Press release' },
  { value: 'ad_copy', label: 'Ad copy' },
  { value: 'talking_points', label: 'Talking points' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

export function MonitoringTable({ results }: { results: MonitoringResult[] }) {
  const router = useRouter();
  const [active, setActive] = useState<MonitoringResult | null>(null);
  const [type, setType] = useState('social_post');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function open(m: MonitoringResult) {
    setActive(m);
    setType('social_post');
    setError('');
  }

  async function handleGenerate() {
    if (!active) return;
    setBusy(true);
    setError('');
    const r = await generateFromMonitoringAction(active.id, type);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Something went wrong.');
      return;
    }
    setActive(null);
    router.push(`/content/${r.contentId}`);
  }

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Subject</th>
              <th>Excerpt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map(m => (
              <tr className="row" key={m.id}>
                <td className="muted">{m.source}</td>
                <td>{m.opponent ?? '—'}</td>
                <td>
                  <a href={m.url} className="linkcell" target="_blank" rel="noopener noreferrer">
                    {m.excerpt}
                  </a>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: '5px 12px' }}
                    onClick={() => open(m)}
                  >
                    Respond
                  </button>
                </td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 24 }}>
                  No monitoring results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => !busy && setActive(null)}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              padding: 28,
              width: '100%',
              maxWidth: 520,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ marginBottom: 20 }}>
              <span className="eyebrow">Generate response</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0' }}>
                Respond to news story
              </h2>
            </div>

            <div style={{
              padding: 14,
              background: 'var(--bg-hover)',
              borderRadius: 8,
              marginBottom: 20,
              borderLeft: '3px solid var(--line)',
            }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                {active.source}{active.opponent ? ` · ${active.opponent}` : ''}
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.65, margin: 0, color: 'var(--text-2)' }}>
                {active.excerpt}
              </p>
              {active.url && (
                <a
                  href={active.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginTop: 8 }}
                >
                  Read full article →
                </a>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="field-label">Content type</label>
              <select
                className="input"
                value={type}
                onChange={e => setType(e.target.value)}
                style={{ width: '100%' }}
                disabled={busy}
              >
                {CONTENT_TYPES.map(ct => (
                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                ))}
              </select>
            </div>

            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 20 }}>
              The AI will read the full news context above and draft a response in your campaign&rsquo;s
              voice. You&rsquo;ll review, edit, and approve before anything is published.
            </p>

            {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={handleGenerate}
              >
                {busy ? 'Generating draft…' : 'Generate draft →'}
              </button>
              <button
                className="btn"
                onClick={() => setActive(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
