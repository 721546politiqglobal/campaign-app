'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { loginAction } from '@/app/actions';
import { INITIAL_FORM_STATE } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { AlertIcon } from '@/components/icons';

export function LoginForm() {
  const t = useTranslations('login');
  const [raw, formAction] = useFormState(loginAction, INITIAL_FORM_STATE);
  // `undefined` while the post-login redirect() is followed (see form-state.ts).
  const state = raw ?? INITIAL_FORM_STATE;

  return (
    <form action={formAction} className="auth-form">
      {state.error && (
        <div className="alert alert-bad" role="alert">
          <AlertIcon className="icon" size={16} />
          <div className="alert-body"><div className="alert-text">{state.error}</div></div>
        </div>
      )}

      <Field label={t('emailLabel')} error={state.fieldErrors?.email}>
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
            defaultValue={state.values?.email ?? ''}
          />
        )}
      </Field>

      <Field
        label={t('passwordLabel')}
        error={state.fieldErrors?.password}
        hint={<><strong className="auth-hint-lead">{t('forgotPassword')}</strong> {t('forgotPasswordHint')}</>}
      >
        {(p) => (
          <input
            {...p}
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        )}
      </Field>

      <SubmitButton block pendingText={t('signingIn')}>{t('signInButton')}</SubmitButton>
    </form>
  );
}
