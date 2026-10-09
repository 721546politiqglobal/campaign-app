'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { uid } from '@/lib/store';
import { scoreCredibility, categorizeSource } from '@/lib/credibility';
import {
  validateManualEntry, MAX_HEADLINE_LEN, MAX_SOURCE_LEN,
  type ManualEntryValues, type ManualEntryErrorCode,
} from './validation';

export interface ManualEntryState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<keyof ManualEntryValues, string>>;
  values?: ManualEntryValues;
  /** Bumps on every successful add so the form can reset and toast once. */
  savedAt?: number;
}

const LIMIT_FOR: Partial<Record<ManualEntryErrorCode, number>> = {
  headlineTooLong: MAX_HEADLINE_LEN,
  sourceTooLong: MAX_SOURCE_LEN,
};

// `useFormState` action: returns field errors + the submitted values so the
// form keeps what the user typed instead of a silent `return`.
export async function addManualEntryAction(_prev: ManualEntryState, formData: FormData): Promise<ManualEntryState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'monitoring.addManually' });

  const values: ManualEntryValues = {
    headline: String(formData.get('headline') ?? '').trim(),
    source: String(formData.get('source') ?? '').trim(),
    url: String(formData.get('url') ?? '').trim(),
  };

  const codes = validateManualEntry(values);
  if (Object.keys(codes).length > 0) {
    const fieldErrors: ManualEntryState['fieldErrors'] = {};
    for (const [field, code] of Object.entries(codes) as [keyof ManualEntryValues, ManualEntryErrorCode][]) {
      fieldErrors[field] = t(`errors.${code}`, { max: LIMIT_FOR[code] ?? 0 });
    }
    return { ok: false, fieldErrors, values };
  }

  try {
    await throwOnError(
      adminDb.from('monitoring_results').insert({
        id: uid(),
        campaign_id: s.campaignId,
        source: values.source,
        excerpt: values.headline,
        url: values.url || '',
        captured_at: new Date().toISOString(),
        credibility: scoreCredibility(values.url),
        category: categorizeSource(values.url, values.source),
      }),
      'monitoring_results.manual_insert',
    );
  } catch (e) {
    console.error('[monitoring] manual entry insert failed', e);
    return { ok: false, error: t('errors.saveFailed'), values };
  }

  revalidatePath('/monitoring');
  return { ok: true, savedAt: Date.now() };
}
