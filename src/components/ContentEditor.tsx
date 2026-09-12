'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContentAction, generateDraftAction } from '@/app/actions';
import type { ContentType } from '@/domain/types';
import type { Locale } from '@/lib/locale';

// Order the picker offers, not the enum's declaration order.
const TYPE_OPTIONS: readonly ContentType[] = [
  'social_post', 'reel', 'press_release', 'ad_copy', 'talking_points',
];

const BRIEF_SUGGESTION_KEYS = [
  'townHall', 'opponentAttack', 'healthcarePlan', 'thankVolunteers', 'pushBackClaim',
] as const;

export function ContentEditor({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('content');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const [type, setType]               = useState((searchParams.get('type') as string) || 'reel');
  const [locale, setLocale]           = useState<Locale>(defaultLocale);
  const [savedLocale, setSavedLocale] = useState<Locale>(defaultLocale);
  const [instruction, setInstruction] = useState(searchParams.get('brief') || '');
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [isAi, setIsAi]               = useState(true);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');
  const [generated, setGenerated]     = useState(false);

  const TYPES = TYPE_OPTIONS.map(v => [v, t(`types.${v}`)] as const);
  const BRIEF_SUGGESTIONS = BRIEF_SUGGESTION_KEYS.map(key => t(`editor.briefSuggestions.${key}`));

  async function generate() {
    if (!instruction.trim()) { setError(t('editor.describeFirst')); return; }
    setBusy(true); setError('');
    try {
      const out = await generateDraftAction(instruction, type, locale);
      // Quota/billing refusals come back as { ok: false, error } and carry the
      // real reason (which limit, and what to do about it) — show it verbatim
      // rather than guessing on the user's behalf.
      if (!out.ok) { setError(out.error); return; }
      setTitle(out.title); setBody(out.text); setSavedLocale(out.locale); setIsAi(true); setGenerated(true);
    } catch {
      // Only unexpected exceptions land here (Next.js redacts their messages in
      // production), so a generic fallback is all that's available.
      setError(t('editor.generateError'));
    } finally { setBusy(false); }
  }

  return (
    <form action={createContentAction}>
      <input type="hidden" name="isAiGenerated" value={isAi ? 'on' : 'off'} />
      <input type="hidden" name="locale" value={savedLocale} />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>{t('editor.brief')}</h2>
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
        <label className="field-label">{t('editor.language')}</label>
        <select
          className="input"
          value={locale}
          onChange={e => setLocale(e.target.value as Locale)}
          style={{ marginBottom: 14, maxWidth: 220 }}
        >
          <option value="en">{tc('languageEnglish')}</option>
          <option value="es">{tc('languageSpanish')}</option>
        </select>
        <label className="field-label">{t('editor.whatShouldThisSay')}</label>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder={t('editor.instructionPlaceholder')}
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
            {busy ? t('editor.writingDraft') : generated ? t('editor.regenerate') : t('editor.generateWithAi')}
          </button>
          {!generated && (
            <button type="button" className="btn" style={{ fontSize: 13 }}
              onClick={() => { setIsAi(false); setGenerated(true); setSavedLocale(locale); }}>
              {t('editor.writeItMyself')}
            </button>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {generated && (
        <div className="card">
          <h2>{t('editor.draft')}</h2>
          <label className="field-label">{t('titleLabel')}</label>
          <input type="text" name="title" className="input" value={title}
            onChange={e => setTitle(e.target.value)} required style={{ marginBottom: 12 }} />
          <label className="field-label">{t('editor.bodyLabel')}</label>
          <textarea name="body" className="input" value={body}
            onChange={e => setBody(e.target.value)} required style={{ minHeight: 180 }} />
          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn primary">{t('editor.saveDraft')}</button>
            {type === 'reel' ? (
              <span className="muted" style={{ fontSize: 13 }}>
                {t('editor.reelsDisclosureNote')}
              </span>
            ) : (
              <label className="checkrow" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={isAi} onChange={e => setIsAi(e.target.checked)} />
                {t('editor.aiGeneratedDisclosure')}
              </label>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
