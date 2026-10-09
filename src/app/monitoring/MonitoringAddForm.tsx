'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { useToast } from '@/components/Toast';
import { AlertIcon } from '@/components/icons';
import { addManualEntryAction, type ManualEntryState } from './actions';
import { MAX_HEADLINE_LEN, MAX_SOURCE_LEN } from './validation';

const INITIAL: ManualEntryState = { ok: false };

export function MonitoringAddForm() {
  const t = useTranslations('monitoring.addManually');
  const { toast } = useToast();
  const [state, formAction] = useFormState(addManualEntryAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef<number | undefined>(undefined);

  // One toast + one reset per successful add (savedAt bumps each time).
  useEffect(() => {
    if (!state.ok || !state.savedAt || state.savedAt === lastSaved.current) return;
    lastSaved.current = state.savedAt;
    toast(t('added'));
    formRef.current?.reset();
  }, [state, t, toast]);

  const errors = state.fieldErrors ?? {};
  const values = state.values;

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon size={16} />
          <div className="alert-body"><div className="alert-text">{state.error}</div></div>
        </div>
      )}
      <div className="field-row">
        <Field label={t('headlineLabel')} error={errors.headline} required>
          {(p) => (
            <input {...p} name="headline" className="input" required maxLength={MAX_HEADLINE_LEN}
              defaultValue={values?.headline ?? ''} placeholder={t('headlinePlaceholder')} />
          )}
        </Field>
        <Field label={t('sourceLabel')} error={errors.source} required>
          {(p) => (
            <input {...p} name="source" className="input" required maxLength={MAX_SOURCE_LEN}
              defaultValue={values?.source ?? ''} placeholder={t('sourcePlaceholder')} />
          )}
        </Field>
      </div>
      <Field label={t('urlLabel')} optionalLabel={t('urlOptional')} hint={t('urlHint')} error={errors.url}>
        {(p) => (
          <input {...p} name="url" type="url" className="input" inputMode="url"
            defaultValue={values?.url ?? ''} placeholder="https://" />
        )}
      </Field>
      <div className="form-actions mon-form-actions">
        <SubmitButton pendingText={t('submitting')}>{t('submitButton')}</SubmitButton>
      </div>
    </form>
  );
}
