import { useId, type ReactNode } from 'react';

/**
 * Form field wrapper: label + control + hint / error, with the label always
 * associated to the control and `aria-describedby` / `aria-invalid` wired up.
 * Server-safe (uses only `useId`, which works in Server Components).
 *
 * Two ways to use it:
 *
 *   // 1. Render-prop — Field generates the id and hands you the a11y props:
 *   <Field label={t('email')} hint={t('emailHint')} error={errors.email} required>
 *     {(p) => <input {...p} name="email" type="email" required />}
 *   </Field>
 *
 *   // 2. Explicit id — you own the control, pass `htmlFor` matching its `id`:
 *   <Field label={t('email')} htmlFor="email" error={errors.email}>
 *     <input id="email" name="email" aria-invalid={!!errors.email} />
 *   </Field>
 *
 * `p` is `{ id, 'aria-describedby', 'aria-invalid' }`. Controls get the base
 * input style from globals.css automatically (`.input` is optional).
 */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** Secondary helper text under the control. */
  hint?: ReactNode;
  /** Validation message; when set the control is marked invalid. */
  error?: ReactNode;
  /** Id of the control when you render it yourself. Omit to use the render-prop form. */
  htmlFor?: string;
  /** Marks the label with a required asterisk (visual only — also set `required` on the control). */
  required?: boolean;
  /** Shows an "optional" affix after the label. */
  optionalLabel?: ReactNode;
  className?: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

export function Field({ label, hint, error, htmlFor, required, optionalLabel, className, children }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? `field${generated}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="field-required" aria-hidden="true">*</span>}
        {optionalLabel && <span className="field-label-optional">{optionalLabel}</span>}
      </label>
      {typeof children === 'function' ? children(control) : children}
      {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
      {hint && <span className="field-hint" id={hintId}>{hint}</span>}
    </div>
  );
}
