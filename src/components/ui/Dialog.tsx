'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { XIcon } from '@/components/icons';

/**
 * Accessible modal built on the native `<dialog>` element: `showModal()` gives
 * a focus trap and inert background, Escape closes, focus returns to the
 * element that opened it, and the dialog is labelled by its title.
 *
 *   const [open, setOpen] = useState(false);
 *   <Dialog open={open} onClose={() => setOpen(false)} title={t('title')}
 *           description={t('description')}
 *           footer={<><button className="btn" onClick={...}>{t('cancel')}</button>
 *                    <button className="btn btn-primary" onClick={...}>{t('save')}</button></>}>
 *     ...body...
 *   </Dialog>
 *
 * Props: `size` 'sm' (440) | 'md' (560) | 'lg' (760); `closeOnBackdrop`
 * (default true); `hideClose` hides the X button; `initialFocusRef` focuses a
 * specific control on open.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
  hideClose?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export function Dialog({
  open, onClose, title, description, children, footer,
  size = 'sm', closeOnBackdrop = true, hideClose, initialFocusRef, className,
}: DialogProps) {
  const t = useTranslations('common');
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  // Native `close` fires for Escape and for programmatic close; restore focus
  // to the opener and tell the owner the dialog is gone.
  const handleClose = () => {
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el && typeof el.focus === 'function') el.focus();
    onClose();
  };

  const sizeClass = size === 'md' ? ' dialog-md' : size === 'lg' ? ' dialog-lg' : '';

  return (
    <dialog
      ref={ref}
      className={`dialog${sizeClass}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      onClose={handleClose}
      onCancel={(e) => { e.preventDefault(); ref.current?.close(); }}
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) ref.current?.close(); }}
    >
      <div className="dialog-header">
        <div style={{ minWidth: 0 }}>
          <h2 className="dialog-title" id={titleId}>{title}</h2>
          {description && <p className="dialog-desc" id={descId}>{description}</p>}
        </div>
        {!hideClose && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm dialog-close" onClick={() => ref.current?.close()} aria-label={t('close')}>
            <XIcon />
          </button>
        )}
      </div>
      {children !== undefined && children !== null && <div className="dialog-body">{children}</div>}
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
