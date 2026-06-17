'use client';

import { useState } from 'react';
import { createContentAction, generateDraftAction } from '@/app/actions';

const TYPES = [
  ['social_post', 'Social post'], ['reel', 'Reel script'], ['press_release', 'Press release'],
  ['email', 'Email'], ['sms', 'SMS'], ['ad_copy', 'Ad copy'], ['talking_points', 'Talking points'],
] as const;

export function ContentEditor() {
  const [type, setType] = useState('social_post');
  const [instruction, setInstruction] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isAi, setIsAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (!instruction.trim()) { setError('Describe what you want first.'); return; }
    setBusy(true); setError('');
    try {
      const out = await generateDraftAction(instruction, type);
      setTitle(out.title); setBody(out.text); setIsAi(true);
    } catch {
      setError('Could not generate a draft. The spend cap may be reached.');
    } finally { setBusy(false); }
  }

  return (
    <form action={createContentAction}>
      <div className="grid cols-2">
        <div className="card">
          <h2>Brief</h2>
          <label className="field">
            <span className="cap">Type</span>
            <select name="type" value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="cap">What should this say?</span>
            <textarea value={instruction} onChange={e => setInstruction(e.target.value)}
              placeholder="e.g. Make a reel about our healthcare plan lowering premiums" />
          </label>
          <button type="button" className="btn primary" onClick={generate} disabled={busy}>
            {busy ? 'Generating\u2026' : 'Generate draft with AI'}
          </button>
          {error && <div className="error">{error}</div>}
        </div>

        <div className="card">
          <h2>Draft</h2>
          <label className="field">
            <span className="cap">Title</span>
            <input type="text" name="title" value={title} onChange={e => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span className="cap">Body</span>
            <textarea name="body" value={body} onChange={e => setBody(e.target.value)} required />
          </label>
          <label className="checkrow">
            <input type="checkbox" name="isAiGenerated" checked={isAi} onChange={e => setIsAi(e.target.checked)} />
            AI-generated (requires a disclosure before publishing)
          </label>
          <div className="spacer-y" />
          <button type="submit" className="btn primary">Save draft</button>
        </div>
      </div>
    </form>
  );
}
