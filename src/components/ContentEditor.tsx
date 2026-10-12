'use client';

import { useId, useState } from 'react';
import { useFormState } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContentAction, generateDraftAction, type CreateContentState } from '@/app/actions';
import { isContentType, type ContentType } from '@/domain/types';
import type { Locale } from '@/lib/locale';
import { Field } from '@/components/ui/Field';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { SubmitButton } from '@/components/SubmitButton';
import { Icon } from '@/components/icons';

// Order the picker offers, not the enum's declaration order.
const TYPE_OPTIONS: readonly ContentType[] = [
  'social_post', 'reel', 'press_release', 'ad_copy', 'talking_points',
];

const BRIEF_SUGGESTION_KEYS = [
  'townHall', 'opponentAttack', 'healthcarePlan', 'thankVolunteers', 'pushBackClaim',
] as const;

const INITIAL_STATE: CreateContentState = { ok: true };

/** The monitored story a "Draft rebuttal" link is responding to (loaded server-side). */
export type RespondToStory = { id: string; source: string; excerpt: string; url: string };

export function ContentEditor({ defaultLocale, respondTo }: { defaultLocale: Locale; respondTo?: RespondToStory }) {
  const t = useTranslations('content');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const id = useId();
  // Monitoring's "respond to this" link lands here as ?brief=…&type=social_post.
  const requestedType = searchParams.get('type') ?? '';
  const [type, setType]               = useState<ContentType>(isContentType(requestedType) ? requestedType : 'reel');
  const [locale, setLocale]           = useState<Locale>(defaultLocale);
  const [savedLocale, setSavedLocale] = useState<Locale>(defaultLocale);
  const [instruction, setInstruction] = useState(searchParams.get('brief') || '');
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [isAi, setIsAi]               = useState(true);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');
  const [generated, setGenerated]     = useState(false);
  // What the last generation produced — regenerating over edits asks first.
  const [snapshot, setSnapshot]       = useState<{ title: string; body: string } | null>(null);
  const [rawSaveState, saveAction]    = useFormState(createContentAction, INITIAL_STATE);
  // `undefined` while the redirect() to the new item is followed (see lib/form-state.ts).
  const saveState = rawSaveState ?? INITIAL_STATE;

  const dirty = snapshot !== null && (title !== snapshot.title || body !== snapshot.body);

  async function generate() {
    if (!instruction.trim()) { setError(t('editor.describeFirst')); return; }
    if (dirty) {
      const ok = await confirm({
        title: t('editor.regenerateConfirm.title'),
        description: t('editor.regenerateConfirm.description'),
        confirmLabel: t('editor.regenerateConfirm.confirm'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true); setError('');
    try {
      const out = await generateDraftAction(instruction, type, locale, respondTo?.id);
      // Quota/billing refusals come back as { ok: false, error } and carry the
      // real reason (which limit, and what to do about it) — show it verbatim
      // rather than guessing on the user's behalf.
      if (!out.ok) { setError(out.error); return; }
      setTitle(out.title); setBody(out.text); setSavedLocale(out.locale);
      setSnapshot({ title: out.title, body: out.text });
      setIsAi(true); setGenerated(true);
    } catch {
      // Only unexpected exceptions land here (Next.js redacts their messages in
      // production), so a generic fallback is all that's available.
      setError(t('editor.generateError'));
    } finally { setBusy(false); }
  }

  function writeMyself() {
    setIsAi(false); setGenerated(true); setSavedLocale(locale); setSnapshot(null);
  }

  return (
    <form action={saveAction} className="editor-layout">
      <input type="hidden" name="isAiGenerated" value={isAi ? 'on' : 'off'} />
      <input type="hidden" name="locale" value={savedLocale} />

      <section className="card" aria-labelledby={`${id}-brief`}>
        <h2 id={`${id}-brief`}>{t('editor.brief')}</h2>

        {respondTo && (
          <aside className="editor-respond" aria-label={t('editor.respondingTo', { source: respondTo.source })}>
            <p className="editor-respond-label text-sm">{t('editor.respondingTo', { source: respondTo.source })}</p>
            <p className="editor-respond-excerpt text-sm excerpt-clamp">{respondTo.excerpt}</p>
            {respondTo.url && (
              <a href={respondTo.url} target="_blank" rel="noopener noreferrer" className="link text-sm">{t('editor.viewStory')}</a>
            )}
          </aside>
        )}

        <fieldset className="field editor-types">
          <legend className="field-label">{t('editor.typeLabel')}</legend>
          <div className="btnrow" role="radiogroup" aria-label={t('editor.typeLabel')}>
            {TYPE_OPTIONS.map(v => (
              <label key={v} className={`chip${type === v ? ' on' : ''}`}>
                <input
                  type="radio"
                  name="type"
                  value={v}
                  checked={type === v}
                  onChange={() => setType(v)}
                />
                {t(`types.${v}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field-row">
          <Field label={t('editor.language')}>
            {p => (
              <select {...p} value={locale} onChange={e => setLocale(e.target.value as Locale)}>
                <option value="en">{tc('languageEnglish')}</option>
                <option value="es">{tc('languageSpanish')}</option>
              </select>
            )}
          </Field>
        </div>

        <Field label={t('editor.whatShouldThisSay')} error={error || undefined}>
          {p => (
            <textarea
              {...p}
              value={instruction}
              onChange={e => { setInstruction(e.target.value); if (error) setError(''); }}
              placeholder={t('editor.instructionPlaceholder')}
              className="editor-instruction"
            />
          )}
        </Field>

        {!instruction && (
          <div className="editor-suggestions">
            <span className="field-hint">{t('editor.suggestionsLabel')}</span>
            <div className="btnrow">
              {BRIEF_SUGGESTION_KEYS.map(key => {
                const text = t(`editor.briefSuggestions.${key}`);
                return (
                  <button key={key} type="button" className="btn btn-sm" onClick={() => setInstruction(text)}>
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="form-actions editor-actions">
          {!generated && (
            <button type="button" className="btn" onClick={writeMyself} disabled={busy}>
              {t('editor.writeItMyself')}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={generate} disabled={busy} aria-busy={busy}>
            {!busy && <Icon name="sparkles" size={16} />}
            {busy ? t('editor.writingDraft') : generated ? t('editor.regenerate') : t('editor.generateWithAi')}
          </button>
        </div>
      </section>

      {generated && (
        <section className="card" aria-labelledby={`${id}-draft`}>
          <h2 id={`${id}-draft`}>{t('editor.draft')}</h2>
          <p className="field-hint editor-draft-hint">{t('editor.draftHint')}</p>
          <Field label={t('titleLabel')} required>
            {p => (
              <input {...p} type="text" name="title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
            )}
          </Field>
          <Field label={t('editor.bodyLabel')} required>
            {p => (
              <textarea {...p} name="body" value={body} onChange={e => setBody(e.target.value)} required className="editor-body" />
            )}
          </Field>

          {type === 'reel' ? (
            <p className="field-hint">{t('editor.reelsDisclosureNote')}</p>
          ) : (
            <label className="checkrow text-sm">
              <input type="checkbox" checked={isAi} onChange={e => setIsAi(e.target.checked)} />
              {t('editor.aiGeneratedDisclosure')}
            </label>
          )}

          {!saveState.ok && (
            <div className="alert alert-bad" role="alert">
              <span className="icon"><Icon name="error" size={16} /></span>
              <div className="alert-body"><div className="alert-text">{saveState.error}</div></div>
            </div>
          )}

          <div className="form-actions">
            <SubmitButton pendingText={t('editor.savingDraft')} disabled={busy}>
              {t('editor.saveDraft')}
              <Icon name="arrow-right" size={16} />
            </SubmitButton>
          </div>
        </section>
      )}
    </form>
  );
}
