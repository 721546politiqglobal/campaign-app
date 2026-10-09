'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from './Dialog';

/**
 * Promise-based confirmation for destructive / billing actions.
 *
 *   const confirm = useConfirm();
 *   async function onDelete() {
 *     const ok = await confirm({
 *       title: t('deleteTitle'),
 *       description: t('deleteDescription', { name }),
 *       confirmLabel: t('delete'),
 *       tone: 'danger',
 *     });
 *     if (!ok) return;
 *     ...
 *   }
 *
 * `ConfirmProvider` is mounted once in the root layout (next to ToastProvider).
 * Options: title (required), description, confirmLabel, cancelLabel, tone
 * 'default' | 'danger'. Resolves `false` on cancel / Escape / backdrop click.
 */
export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // A second request while one is pending cancels the first.
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog options={options} onSettle={settle} />
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions | null; onSettle: (v: boolean) => void }) {
  const t = useTranslations('common.confirm');
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Keep the last options around while the close animation runs.
  const lastRef = useRef<ConfirmOptions | null>(null);
  if (options) lastRef.current = options;
  const shown = options ?? lastRef.current;
  if (!shown) return null;

  const danger = shown.tone === 'danger';

  return (
    <Dialog
      open={!!options}
      onClose={() => onSettle(false)}
      title={shown.title}
      description={shown.description}
      initialFocusRef={confirmRef}
      hideClose
      footer={
        <>
          <button type="button" className="btn" onClick={() => onSettle(false)}>
            {shown.cancelLabel ?? t('cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => onSettle(true)}
          >
            {shown.confirmLabel ?? t('confirm')}
          </button>
        </>
      }
    />
  );
}
