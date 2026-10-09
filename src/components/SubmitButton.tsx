'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Submit button for `<form action={serverAction}>`: disables itself and shows a
 * spinner + pending label while the action runs (`useFormStatus`).
 *
 *   <SubmitButton pendingText={t('saving')}>{t('save')}</SubmitButton>
 *   <SubmitButton variant="danger" size="sm" pendingText={t('deleting')}>{t('delete')}</SubmitButton>
 *
 * `variant`: 'primary' (default) | 'secondary' | 'ghost' | 'danger' | 'danger-soft'.
 * `size`: 'sm' | 'md' (default) | 'lg'. `block` stretches to full width.
 * Passing `className` overrides the generated classes entirely (legacy usage).
 */
export interface SubmitButtonProps {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  name?: string;
  value?: string;
  formAction?: string | ((formData: FormData) => void | Promise<void>);
  'aria-label'?: string;
}

const VARIANT_CLASS: Record<NonNullable<SubmitButtonProps['variant']>, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  'danger-soft': 'btn btn-danger-soft',
};

export function SubmitButton({
  children, pendingText, variant = 'primary', size = 'md', block, className, style, disabled, name, value, formAction, ...rest
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const classes = className ?? [
    VARIANT_CLASS[variant],
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    block ? 'btn-block' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="submit"
      className={classes}
      style={style}
      disabled={pending || disabled}
      aria-busy={pending}
      name={name}
      value={value}
      formAction={formAction}
      {...rest}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
