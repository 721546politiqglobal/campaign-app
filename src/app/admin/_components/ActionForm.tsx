'use client';

import { useRef, type FormEvent, type ReactNode } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/Toast';
import { useConfirm, type ConfirmOptions } from '@/components/ui/ConfirmDialog';
import { ErrorIcon } from '@/components/icons';
import type { AdminActionResult } from '@/app/admin/actions';

/**
 * `<form action>` wrapper for admin server actions that return
 * `{ ok, error?, values? }`:
 *  - carries the result in `useFormState` so errors render inline (translated)
 *    and typed values survive a failed submit (`values` via the render prop);
 *  - toasts `successMessage` on `ok`;
 *  - optional `confirm` (object or `(formData) => options | null`) runs
 *    `useConfirm()` before the action — use it for billing / destructive forms;
 *  - a thrown error becomes a generic translated message, never a stuck form.
 *
 *   <ActionForm action={addUserAction} successMessage={t('userAdded')}>
 *     {({ values }) => <>…<SubmitButton>…</SubmitButton></>}
 *   </ActionForm>
 */
export type AdminFormState = AdminActionResult | null;
type ConfirmSpec = ConfirmOptions | ((formData: FormData) => ConfirmOptions | null);

export interface ActionFormRender {
  error: string | null;
  values: Record<string, string>;
}

export interface ActionFormProps {
  action: (formData: FormData) => Promise<AdminActionResult>;
  successMessage?: ReactNode;
  confirm?: ConfirmSpec;
  className?: string;
  id?: string;
  children: ReactNode | ((state: ActionFormRender) => ReactNode);
}

export function ActionForm({ action, successMessage, confirm, className, id, children }: ActionFormProps) {
  const t = useTranslations('admin.common');
  const { toast } = useToast();
  const ask = useConfirm();
  const confirmedRef = useRef(false);

  const [state, formAction] = useFormState<AdminFormState, FormData>(async (_prev, formData) => {
    try {
      const result = await action(formData);
      // In Next 14.2 an action that `redirect()`s resolves with `undefined` on
      // the client while the navigation is followed — not an error, nothing to
      // show (reading `result.ok` here would flash the generic error first).
      if (!result) return null;
      if (result.ok && successMessage) toast(successMessage, 'success');
      return result;
    } catch (e) {
      console.error(e);
      return { ok: false, error: t('genericError') };
    }
  }, null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!confirm) return;
    if (confirmedRef.current) { confirmedRef.current = false; return; }
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const options = typeof confirm === 'function' ? confirm(new FormData(form)) : confirm;
    if (options && !(await ask(options))) return;
    confirmedRef.current = true;
    form.requestSubmit(submitter ?? undefined);
  }

  const error = state && !state.ok ? state.error : null;
  const values = state && !state.ok ? (state.values ?? {}) : {};

  return (
    <form action={formAction} onSubmit={onSubmit} className={className} id={id}>
      {error && (
        <div className="alert alert-bad admin-form-alert" role="alert">
          <ErrorIcon className="icon" size={16} />
          <div className="alert-body"><div className="alert-text">{error}</div></div>
        </div>
      )}
      {typeof children === 'function' ? children({ error, values }) : children}
    </form>
  );
}
