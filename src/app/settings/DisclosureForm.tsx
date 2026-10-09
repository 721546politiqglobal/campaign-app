'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { saveDisclosureDefaultAction } from './actions';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { useToast } from '@/components/Toast';
import { AlertIcon } from '@/components/icons';

export function DisclosureForm({ initialValue }: { initialValue: string }) {
  const t = useTranslations('settings');
  const { toast } = useToast();
  const [state, formAction] = useFormState(saveDisclosureDefaultAction, INITIAL_FORM_STATE);
  const lastSavedRef = useRef<number | undefined>(undefined);

  const value = state.values?.default_disclosure_text ?? initialValue;

  useEffect(() => {
    if (state.ok && state.savedAt && state.savedAt !== lastSavedRef.current) {
      lastSavedRef.current = state.savedAt;
      toast(t('disclosure.saved'));
    }
  });

  return (
    <form action={formAction} className="stack">
      {!state.ok && state.error && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon size={16} />
          <div className="alert-body"><div className="alert-text">{state.error}</div></div>
        </div>
      )}
      <Field label={t('disclosure.heading')} hint={t('disclosure.description')} error={state.fieldErrors?.default_disclosure_text}>
        {p => (
          <textarea
            {...p}
            name="default_disclosure_text"
            className="input acct-textarea-sm"
            defaultValue={value}
            placeholder={t('disclosure.placeholder')}
          />
        )}
      </Field>
      <div className="form-actions">
        <SubmitButton pendingText={t('profile.saving')}>{t('disclosure.saveButton')}</SubmitButton>
      </div>
    </form>
  );
}
