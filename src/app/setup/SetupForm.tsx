'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { PARTIES, PROFILE_MAX_LENGTHS } from '@/lib/profile-validation';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { AlertIcon } from '@/components/icons';
import { upsertProfileAction } from './actions';

const TONES = ['conversational', 'formal', 'urgent', 'inspirational'] as const;

export function SetupForm() {
  const t = useTranslations('setup');
  const tc = useTranslations('common');
  const [raw, formAction] = useFormState(upsertProfileAction, INITIAL_FORM_STATE);
  // `undefined` while the post-save redirect() is followed (see form-state.ts).
  const state = raw ?? INITIAL_FORM_STATE;
  const v = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(errors).length > 0;
  const tone = v.voice_tone ?? 'conversational';

  return (
    <form action={formAction} className="stack setup-form">
      {(state.error || hasFieldErrors) && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon className="icon" size={16} />
          <div className="alert-body">
            <div className="alert-title">{state.error ?? t('fixErrorsTitle')}</div>
            {!state.error && <div className="alert-text">{t('fixErrorsBody')}</div>}
          </div>
        </div>
      )}

      <section className="card card-sectioned">
        <div className="card-header">
          <div className="card-header-text">
            <h2>{t('candidateHeading')}</h2>
            <span className="card-header-desc">{t('candidateDescription')}</span>
          </div>
        </div>
        <div className="card-body">
          <div className="field-row">
            <Field label={t('fields.fullName')} error={errors.full_name} required>
              {(p) => <input {...p} name="full_name" required maxLength={PROFILE_MAX_LENGTHS.fullName} autoComplete="off" placeholder={t('fields.fullNamePlaceholder')} defaultValue={v.full_name ?? ''} />}
            </Field>
            <Field label={t('fields.preferredName')} error={errors.preferred_name} required>
              {(p) => <input {...p} name="preferred_name" required maxLength={PROFILE_MAX_LENGTHS.preferredName} autoComplete="off" placeholder={t('fields.preferredNamePlaceholder')} defaultValue={v.preferred_name ?? ''} />}
            </Field>
            <Field label={t('fields.office')} error={errors.office} required>
              {(p) => <input {...p} name="office" required maxLength={PROFILE_MAX_LENGTHS.office} placeholder={t('fields.officePlaceholder')} defaultValue={v.office ?? ''} />}
            </Field>
            <Field label={t('fields.district')} error={errors.district} required>
              {(p) => <input {...p} name="district" required maxLength={PROFILE_MAX_LENGTHS.district} placeholder={t('fields.districtPlaceholder')} defaultValue={v.district ?? ''} />}
            </Field>
            <Field label={t('fields.party')} error={errors.party} required>
              {(p) => (
                <select {...p} name="party" required defaultValue={v.party ?? ''}>
                  <option value="" disabled>{t('fields.partyPlaceholder')}</option>
                  {PARTIES.map(party => (
                    <option key={party} value={party}>{tc(`parties.${party.toLowerCase() as Lowercase<typeof party>}`)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('fields.primaryOpponent')} error={errors.opponent_name} optionalLabel={t('optional')}>
              {(p) => <input {...p} name="opponent_name" placeholder={t('fields.opponentNamePlaceholder')} defaultValue={v.opponent_name ?? ''} />}
            </Field>
          </div>
          <Field label={t('fields.photoUrl')} error={errors.photo_url} optionalLabel={t('optional')}>
            {(p) => <input {...p} type="url" name="photo_url" inputMode="url" placeholder={t('fields.photoUrlPlaceholder')} defaultValue={v.photo_url ?? ''} />}
          </Field>
        </div>
      </section>

      <section className="card card-sectioned">
        <div className="card-header">
          <div className="card-header-text">
            <h2>{t('voiceHeading')}</h2>
            <span className="card-header-desc">{t('voiceDescription')}</span>
          </div>
        </div>
        <div className="card-body">
          <Field label={t('bioLabel')} hint={t('bioHint')} error={errors.bio}>
            {(p) => <textarea {...p} name="bio" rows={3} maxLength={PROFILE_MAX_LENGTHS.bio} className="setup-textarea-sm" placeholder={t('bioPlaceholder')} defaultValue={v.bio ?? ''} />}
          </Field>
          <div className="field-row">
            <Field label={t('taglineLabel')} error={errors.tagline}>
              {(p) => <input {...p} name="tagline" maxLength={PROFILE_MAX_LENGTHS.tagline} placeholder={t('taglinePlaceholder')} defaultValue={v.tagline ?? ''} />}
            </Field>
            <Field label={t('targetAudienceLabel')} error={errors.target_audience}>
              {(p) => <input {...p} name="target_audience" maxLength={PROFILE_MAX_LENGTHS.targetAudience} placeholder={t('targetAudiencePlaceholder')} defaultValue={v.target_audience ?? ''} />}
            </Field>
          </div>
          <Field label={t('keyPositionsLabel')} hint={t('keyPositionsHint')} error={errors.key_positions}>
            {(p) => <textarea {...p} name="key_positions" rows={4} placeholder={t('keyPositionsPlaceholder')} defaultValue={v.key_positions ?? ''} />}
          </Field>
        </div>
      </section>

      <section className="card card-sectioned">
        <div className="card-header">
          <div className="card-header-text">
            <h2 id="setup-tone-heading">{t('toneHeading')}</h2>
            <span className="card-header-desc" id="setup-tone-desc">{t('toneDescription')}</span>
          </div>
        </div>
        <div className="card-body">
          <div className="tone-grid" role="radiogroup" aria-labelledby="setup-tone-heading" aria-describedby="setup-tone-desc">
            {TONES.map(value => (
              <label key={value} className="tone-option">
                <input type="radio" name="voice_tone" value={value} defaultChecked={tone === value} />
                <span className="tone-option-text">
                  <span className="tone-option-label">{t(`tones.${value}.label`)}</span>
                  <span className="tone-option-desc">{t(`tones.${value}.desc`)}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.voice_tone && <span className="field-error" role="alert">{errors.voice_tone}</span>}
        </div>
      </section>

      <div className="form-actions">
        <SubmitButton size="lg" pendingText={t('saving')}>{t('submitButton')}</SubmitButton>
      </div>
    </form>
  );
}
