'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { saveProfileAction } from './actions';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { useToast } from '@/components/Toast';
import { AlertIcon } from '@/components/icons';

export interface SelectOption { value: string; label: string }

/**
 * Candidate profile editor. Server validation comes back through
 * `useFormState` as field errors + the submitted values, so nothing the user
 * typed is lost on a failed save; a toast confirms a successful one.
 */
export function ProfileForm({ initialValues, partyOptions, toneOptions, localeOptions }: {
  initialValues: Record<string, string>;
  partyOptions: SelectOption[];
  toneOptions: SelectOption[];
  localeOptions: SelectOption[];
}) {
  const t = useTranslations('settings');
  const { toast } = useToast();
  const [state, formAction] = useFormState(saveProfileAction, INITIAL_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedRef = useRef<number | undefined>(undefined);

  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok && state.savedAt && state.savedAt !== lastSavedRef.current) {
      lastSavedRef.current = state.savedAt;
      toast(t('profile.saved'));
    }
    if (!state.ok && state.fieldErrors) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  });

  return (
    <form ref={formRef} action={formAction} className="stack">
      {!state.ok && state.error && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon size={16} />
          <div className="alert-body"><div className="alert-text">{state.error}</div></div>
        </div>
      )}

      <div className="acct-fields">
        <Field label={t('profile.fields.fullName')} required error={errors.full_name}>
          {p => <input {...p} name="full_name" className="input" defaultValue={values.full_name} required maxLength={120} autoComplete="off" />}
        </Field>
        <Field label={t('profile.fields.preferredName')} required hint={t('profile.hints.preferredName')} error={errors.preferred_name}>
          {p => <input {...p} name="preferred_name" className="input" defaultValue={values.preferred_name} required maxLength={120} autoComplete="off" />}
        </Field>
        <Field label={t('profile.fields.office')} required error={errors.office}>
          {p => <input {...p} name="office" className="input" defaultValue={values.office} required maxLength={120} />}
        </Field>
        <Field label={t('profile.fields.district')} required error={errors.district}>
          {p => <input {...p} name="district" className="input" defaultValue={values.district} required maxLength={120} />}
        </Field>
        <Field label={t('profile.fields.party')} error={errors.party}>
          {p => (
            <select {...p} name="party" className="input" defaultValue={values.party}>
              <option value="">{t('profile.fields.partyNone')}</option>
              {partyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </Field>
        <Field label={t('profile.fields.primaryOpponent')} error={errors.opponent_name}>
          {p => <input {...p} name="opponent_name" className="input" defaultValue={values.opponent_name} maxLength={120} />}
        </Field>
      </div>

      <Field label={t('profile.fields.bio')} error={errors.bio}>
        {p => <textarea {...p} name="bio" className="input acct-textarea-sm" defaultValue={values.bio} maxLength={600} />}
      </Field>

      <div className="acct-fields">
        <Field label={t('profile.fields.tagline')} error={errors.tagline}>
          {p => <input {...p} name="tagline" className="input" defaultValue={values.tagline} maxLength={160} />}
        </Field>
        <Field label={t('profile.fields.targetAudience')} error={errors.target_audience}>
          {p => <input {...p} name="target_audience" className="input" defaultValue={values.target_audience} maxLength={200} />}
        </Field>
      </div>

      <Field label={t('profile.fields.keyPositions')} hint={t('profile.hints.keyPositions')} error={errors.key_positions}>
        {p => <textarea {...p} name="key_positions" className="input acct-textarea-md" defaultValue={values.key_positions} />}
      </Field>

      <div className="acct-fields">
        <Field label={t('profile.fields.voiceTone')} error={errors.voice_tone}>
          {p => (
            <select {...p} name="voice_tone" className="input" defaultValue={values.voice_tone}>
              {toneOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </Field>
        <Field label={t('profile.fields.contentLocale')} hint={t('profile.hints.contentLocale')} error={errors.content_locale}>
          {p => (
            <select {...p} name="content_locale" className="input" defaultValue={values.content_locale}>
              {localeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </Field>
      </div>

      <div className="acct-subsection">
        <span className="eyebrow">{t('profile.monitoring.eyebrow')}</span>
        <p>{t('profile.monitoring.description')}</p>
      </div>

      <Field label={t('profile.monitoring.opponentAliases')} error={errors.opponent_aliases}>
        {p => <input {...p} name="opponent_aliases" className="input" defaultValue={values.opponent_aliases} />}
      </Field>
      <Field label={t('profile.monitoring.monitoringKeywords')} error={errors.monitoring_keywords}>
        {p => <input {...p} name="monitoring_keywords" className="input" defaultValue={values.monitoring_keywords} />}
      </Field>

      <div className="acct-fields">
        <Field label={t('profile.monitoring.opponentTwitter')} hint={t('profile.hints.opponentTwitter')} error={errors.opponent_twitter_handle}>
          {p => <input {...p} name="opponent_twitter_handle" className="input" defaultValue={values.opponent_twitter_handle} autoComplete="off" />}
        </Field>
        <Field label={t('profile.monitoring.opponentInstagram')} error={errors.opponent_instagram_handle}>
          {p => <input {...p} name="opponent_instagram_handle" className="input" defaultValue={values.opponent_instagram_handle} autoComplete="off" />}
        </Field>
        <Field label={t('profile.monitoring.opponentFacebook')} error={errors.opponent_facebook_page}>
          {p => <input {...p} name="opponent_facebook_page" className="input" defaultValue={values.opponent_facebook_page} autoComplete="off" />}
        </Field>
      </div>

      <Field label={t('profile.monitoring.googleAlertsRssUrl')} hint={t('profile.hints.googleAlertsRssUrl')} error={errors.google_alerts_rss_url}>
        {p => <input {...p} name="google_alerts_rss_url" className="input" type="url" inputMode="url" defaultValue={values.google_alerts_rss_url} placeholder="https://" />}
      </Field>

      <div className="form-actions">
        <SubmitButton pendingText={t('profile.saving')}>{t('profile.saveButton')}</SubmitButton>
      </div>
    </form>
  );
}
