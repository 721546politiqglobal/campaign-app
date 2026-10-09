'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { joinAction } from '@/app/actions';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { AlertIcon } from '@/components/icons';

export function JoinForm({ code }: { code: string }) {
  const t = useTranslations('join');
  const [raw, formAction] = useFormState(joinAction, INITIAL_FORM_STATE);
  // `undefined` while the post-join redirect() is followed (see form-state.ts).
  const state = raw ?? INITIAL_FORM_STATE;
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="auth-form">
      {state.error && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon className="icon" size={16} />
          <div className="alert-body"><div className="alert-text">{state.error}</div></div>
        </div>
      )}

      <Field label={t('inviteCodeLabel')} error={errors.code} required>
        {(p) => (
          <input
            {...p}
            name="code"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="auth-code-input"
            placeholder={t('inviteCodePlaceholder')}
            defaultValue={values.code ?? code}
          />
        )}
      </Field>

      <Field label={t('fullNameLabel')} error={errors.name} required>
        {(p) => (
          <input
            {...p}
            name="name"
            required
            autoComplete="name"
            placeholder={t('fullNamePlaceholder')}
            defaultValue={values.name ?? ''}
          />
        )}
      </Field>

      <Field label={t('emailLabel')} error={errors.email} required>
        {(p) => (
          <input
            {...p}
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t('emailPlaceholder')}
            defaultValue={values.email ?? ''}
          />
        )}
      </Field>

      <Field label={t('passwordLabel')} error={errors.password} hint={t('passwordHint')} required>
        {(p) => (
          <input
            {...p}
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t('passwordPlaceholder')}
          />
        )}
      </Field>

      <SubmitButton block pendingText={t('creatingAccount')}>{t('createAccountButton')}</SubmitButton>
    </form>
  );
}
