'use client';

import { createContext, useContext, useState, useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SuccessIcon, ErrorIcon, InfoIcon, XIcon } from '@/components/icons';

/**
 * Toast notifications.
 *
 *   const { toast } = useToast();
 *   toast(t('saved'));                       // success, 5s
 *   toast(t('failed'), 'error');             // role="alert", assertive region
 *   toast(t('dismissed'), 'info', { duration: 8000, action: { label: t('undo'), onClick: undo } });
 *
 * Timers pause while the toast is hovered or focused.
 */
export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** ms before auto-dismiss; default 5000. 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: ReactNode; onClick: () => void };
}

interface ToastRecord {
  id: string;
  message: ReactNode;
  type: ToastType;
  duration: number;
  action?: ToastOptions['action'];
}

interface ToastCtx {
  toast: (message: ReactNode, type?: ToastType, options?: ToastOptions) => void;
}

const DEFAULT_DURATION = 5000;
const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const baseId = useId();
  const counterRef = useRef(0);

  const toast = useCallback<ToastCtx['toast']>((message, type = 'success', options) => {
    const id = `${baseId}-${counterRef.current++}`;
    setToasts(prev => [...prev, { id, message, type, duration: options?.duration ?? DEFAULT_DURATION, action: options?.action }]);
  }, [baseId]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const alerts = toasts.filter(t => t.type === 'error');
  const statuses = toasts.filter(t => t.type !== 'error');

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack">
        <div aria-live="polite" aria-atomic="false" style={{ display: 'contents' }}>
          {statuses.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
        <div aria-live="assertive" aria-atomic="false" style={{ display: 'contents' }}>
          {alerts.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

const ICON = { success: SuccessIcon, error: ErrorIcon, info: InfoIcon } as const;

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const t = useTranslations('common');
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startedRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast.duration <= 0 || paused) return;
    startedRef.current = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      if (startedRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current));
        startedRef.current = null;
      }
    };
  }, [paused, toast.id, toast.duration, onDismiss]);

  const IconCmp = ICON[toast.type];
  const isAlert = toast.type === 'error';

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={isAlert ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <IconCmp size={18} />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button type="button" className="btn btn-ghost btn-sm toast-action" onClick={() => { toast.action?.onClick(); onDismiss(toast.id); }}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-icon btn-sm toast-close" onClick={() => onDismiss(toast.id)} aria-label={t('dismiss')}>
        <XIcon size={14} />
      </button>
    </div>
  );
}
