'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { adminDb, throwOnError } from '@/lib/supabase';
import { upsertCandidateProfile } from '@/lib/candidate';
import { genericMonitoringTerms, validateCandidateProfile, PROFILE_MAX_LENGTHS, PROFILE_REQUIRED_FIELDS } from '@/lib/profile-validation';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/lib/locale';
import type { VoiceTone } from '@/domain/types';
import type { ActionFormState } from '@/lib/form-state';

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Every control in the profile form, by `name`. Echoed back in `values` on a
// failed save so the client can re-render exactly what the user typed.
const PROFILE_FORM_FIELDS = [
  'full_name', 'preferred_name', 'office', 'district', 'party', 'opponent_name',
  'bio', 'tagline', 'target_audience', 'key_positions', 'voice_tone', 'content_locale',
  'opponent_aliases', 'monitoring_keywords', 'opponent_twitter_handle',
  'opponent_instagram_handle', 'opponent_facebook_page', 'google_alerts_rss_url',
] as const;

// validateCandidateProfile keys its errors by camelCase ProfileInput field;
// the form (and the client's fieldErrors) use the control names.
const CONTROL_NAME: Record<string, string> = {
  fullName: 'full_name', preferredName: 'preferred_name', office: 'office', district: 'district',
  party: 'party', bio: 'bio', tagline: 'tagline', targetAudience: 'target_audience',
  voiceTone: 'voice_tone', contentLocale: 'content_locale',
  googleAlertsRssUrl: 'google_alerts_rss_url', photoUrl: 'photo_url',
};
// The validator's own messages are English-only, so each failure is re-reported
// here in the user's language using the same required / max-length rules.
const REQUIRED_FIELDS: ReadonlySet<string> = new Set(PROFILE_REQUIRED_FIELDS);
const MAX_LENGTH: Record<string, number> = PROFILE_MAX_LENGTHS;

function translateFieldErrors(
  errors: Record<string, string>,
  fields: Record<string, string>,
  t: Translate,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of Object.keys(errors)) {
    const value = fields[field] ?? '';
    let message: string;
    if (REQUIRED_FIELDS.has(field) && !value.trim()) message = t('validation.required');
    else if (MAX_LENGTH[field] !== undefined && value.length > MAX_LENGTH[field]) message = t('validation.tooLong', { max: MAX_LENGTH[field] });
    else if (field === 'party') message = t('validation.party');
    else if (field === 'contentLocale') message = t('validation.contentLocale');
    else if (field === 'voiceTone') message = t('validation.voiceTone');
    else if (field === 'googleAlertsRssUrl' || field === 'photoUrl') message = t('validation.url');
    else message = t('validation.invalid');
    out[CONTROL_NAME[field] ?? field] = message;
  }
  return out;
}

function readValues(formData: FormData, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) values[name] = String(formData.get(name) ?? '');
  return values;
}

function splitList(raw: string, separator: '\n' | ','): string[] {
  return raw.split(separator).map(p => p.trim()).filter(Boolean);
}

export async function saveProfileAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'settings' });
  const values = readValues(formData, PROFILE_FORM_FIELDS);
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('form.permissionDenied'), values };

  const fields = {
    fullName:       values.full_name.trim(),
    preferredName:  values.preferred_name.trim(),
    office:         values.office.trim(),
    district:       values.district.trim(),
    party:          values.party.trim(),
    bio:            values.bio.trim(),
    tagline:        values.tagline.trim(),
    targetAudience: values.target_audience.trim(),
    voiceTone:      values.voice_tone || 'conversational',
    googleAlertsRssUrl: values.google_alerts_rss_url.trim(),
    contentLocale:  values.content_locale.trim(),
  };
  // Reject garbage before it reaches AI-drafting prompts (UX-3).
  const check = validateCandidateProfile(fields);
  // Generic aliases/keywords ("president", "democrats") make every political
  // story look relevant and flood the opposition feed.
  const monitoringErrors: Record<string, string> = {};
  for (const name of ['opponent_aliases', 'monitoring_keywords'] as const) {
    const generic = genericMonitoringTerms(splitList(values[name], ','));
    if (generic.length) monitoringErrors[name] = t('validation.genericTerms', { terms: generic.join(', ') });
  }
  if (!check.ok || Object.keys(monitoringErrors).length) {
    const fieldErrors = { ...(check.ok ? {} : translateFieldErrors(check.errors, fields, t)), ...monitoringErrors };
    return { ok: false, error: t('form.fixErrors'), fieldErrors, values };
  }

  try {
    await upsertCandidateProfile(s.campaignId, {
      fullName:       fields.fullName,
      preferredName:  fields.preferredName,
      office:         fields.office,
      district:       fields.district,
      party:          fields.party,
      bio:            fields.bio,
      keyPositions:   splitList(values.key_positions, '\n'),
      voiceTone:      fields.voiceTone as VoiceTone,
      // Defensive fallback in addition to the blocking validateCandidateProfile
      // check above — belt-and-suspenders against any value that somehow
      // reaches this point outside the select's fixed option set.
      contentLocale:  isSupportedLocale(fields.contentLocale) ? fields.contentLocale : DEFAULT_LOCALE,
      targetAudience: fields.targetAudience,
      tagline:        fields.tagline,
      // photoUrl is deliberately not touched here: the settings form has no
      // photo field, and sending null would wipe the value entered at setup.
      opponentName:   values.opponent_name.trim() || null,
      opponentAliases:    splitList(values.opponent_aliases, ','),
      monitoringKeywords: splitList(values.monitoring_keywords, ','),
      // Strip a leading @ — the n8n workflow builds `from:<handle>` for X search,
      // and that operator rejects a handle prefixed with @.
      opponentTwitterHandle:   values.opponent_twitter_handle.trim().replace(/^@+/, '') || null,
      opponentInstagramHandle: values.opponent_instagram_handle.trim() || null,
      opponentFacebookPage:    values.opponent_facebook_page.trim() || null,
      googleAlertsRssUrl:      fields.googleAlertsRssUrl || null,
    });
  } catch (e) {
    console.error('[settings] saveProfileAction failed', e);
    return { ok: false, error: t('form.saveFailed'), values };
  }

  revalidatePath('/settings');
  return { ok: true, savedAt: Date.now() };
}

export async function saveDisclosureDefaultAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'settings' });
  const values = readValues(formData, ['default_disclosure_text']);
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('form.permissionDenied'), values };

  const text = values.default_disclosure_text.trim();
  try {
    await throwOnError(
      adminDb.from('campaigns').update({ default_disclosure_text: text || null }).eq('id', s.campaignId),
      'campaigns.save_disclosure_default',
    );
  } catch (e) {
    console.error('[settings] saveDisclosureDefaultAction failed', e);
    return { ok: false, error: t('form.saveFailed'), values };
  }

  revalidatePath('/settings');
  return { ok: true, savedAt: Date.now() };
}
