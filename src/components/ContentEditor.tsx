'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createContentAction, generateDraftAction } from '@/app/actions';

const TYPES = [
  ['social_post', 'Social post'], ['reel', 'Reel script'], ['press_release', 'Press release'],
  ['ad_copy', 'Ad copy'], ['talking_points', 'Talking points'],
] as const;

const BRIEF_SUGGESTIONS = [
  'Announce our upcoming town hall event',
  'Respond to an opponent attack ad',
  'Share our healthcare plan highlights',
  'Thank volunteers after a successful event',
  'Push back on a false claim in the news',
];

export function ContentEditor() {
  const searchParams = useSearchParams();
  const [type, setType]               = useState((searchParams.get('type') as string) || 'reel');
  const [instruction, setInstruction] = useState(searchParams.get('brief') || '');
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [isAi, setIsAi]               = useState(true);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');
  const [generated, setGenerated]     = useState(false);

  async function generate() {
    if (!instruction.trim()) { setError('Describe what you want first.'); return; }
    setBusy(true); setError('');
    try {
      const out = await generateDraftAction(instruction, type);
      // Quota/billing refusals come back as { ok: false, error } and carry the
      // real reason (which limit, and what to do about it) — show it verbatim
      // rather than guessing on the user's behalf.
      if (!out.ok) { setError(out.error); return; }
      setTitle(out.title); setBody(out.text); setIsAi(true); setGenerated(true);
    } catch {
      // Only unexpected exceptions land here (Next.js redacts their messages in
      // production), so a generic fallback is all that's available.
      setError('Could not generate a draft. Please try again — if this keeps happening, your AI provider key may not be configured.');
    } finally { setBusy(false); }
  }

  return (
    <form action={createContentAction}>
      <input type="hidden" name="isAiGenerated" value={isAi ? 'on' : 'off'} />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Brief</h2>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {TYPES.map(([v, l]) => (
            <label key={v} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13,
              border: `1.5px solid ${type === v ? 'var(--accent)' : 'var(--line)'}`,
              background: type === v ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
              color: type === v ? 'var(--accent)' : 'var(--text-2)',
            }}>
              <input type="radio" name="type" value={v} checked={type === v}
                onChange={() => setType(v)} style={{ display: 'none' }} />
              {l}
            </label>
          ))}
        </div>
        <label className="field-label">What should this say?</label>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder="e.g. Announce our healthcare town hall on Saturday"
          className="input"
          style={{ minHeight: 80, marginBottom: 10 }}
        />
        {!instruction && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {BRIEF_SUGGESTIONS.map(s => (
              <button key={s} type="button" className="btn"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setInstruction(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn primary" onClick={generate} disabled={busy} style={{ minWidth: 170 }}>
            {busy ? 'Writing your draft…' : generated ? 'Regenerate' : 'Generate with AI'}
          </button>
          {!generated && (
            <button type="button" className="btn" style={{ fontSize: 13 }}
              onClick={() => { setIsAi(false); setGenerated(true); }}>
              Write it myself
            </button>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {generated && (
        <div className="card">
          <h2>Draft</h2>
          <label className="field-label">Title</label>
          <input type="text" name="title" className="input" value={title}
            onChange={e => setTitle(e.target.value)} required style={{ marginBottom: 12 }} />
          <label className="field-label">Body</label>
          <textarea name="body" className="input" value={body}
            onChange={e => setBody(e.target.value)} required style={{ minHeight: 180 }} />
          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn primary">Save draft →</button>
            <label className="checkrow" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={isAi} onChange={e => setIsAi(e.target.checked)} />
              AI-generated (adds required disclosure)
            </label>
          </div>
        </div>
      )}
    </form>
  );
}
