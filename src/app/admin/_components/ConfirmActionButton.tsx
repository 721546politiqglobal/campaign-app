'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/Toast';
import { useConfirm, type ConfirmOptions } from '@/components/ui/ConfirmDialog';
import type { AdminActionResult } from '@/app/admin/actions';

/**
 * Button that (optionally) confirms, then calls an imperative server action
 * with pending state and toast feedback. Never leaves a stuck busy state.
 *
 *   <ConfirmActionButton action={() => removeUserAction(id, campaignId)}
 *     confirm={{ title, description, confirmLabel, tone: 'danger' }}
 *     successMessage={t('removed')} variant="danger-soft" size="sm">{t('remove')}</ConfirmActionButton>
 */
const VARIANT_CLASS = {
  primary: 'btn btn-primary',
  secondary: 'btn',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  'danger-soft': 'btn btn-danger-soft',
} as const;

export interface ConfirmActionButtonProps {
  action: () => Promise<AdminActionResult | void>;
  confirm?: ConfirmOptions;
  successMessage?: ReactNode;
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: keyof typeof VARIANT_CLASS;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
  'aria-label'?: string;
}

export function ConfirmActionButton({
  action, confirm, successMessage, children, pendingText, variant = 'secondary', size = 'md', className, ...rest
}: ConfirmActionButtonProps) {
  const t = useTranslations('admin.common');
  const { toast } = useToast();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    if (confirm && !(await ask(confirm))) return;
    setBusy(true);
    try {
      const result = await action();
      // `undefined`: the action `redirect()`ed (Next 14.2 resolves instead of
      // throwing) or returns nothing — Next navigates, nothing to report.
      if (!result) return;
      if (!result.ok) toast(result.error, 'error');
      else if (successMessage) toast(successMessage, 'success');
    } catch (e) {
      console.error(e);
      toast(t('genericError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const classes = className ?? [VARIANT_CLASS[variant], size === 'sm' ? 'btn-sm' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} onClick={onClick} disabled={busy} aria-busy={busy} {...rest}>
      {busy && pendingText ? pendingText : children}
    </button>
  );
}
