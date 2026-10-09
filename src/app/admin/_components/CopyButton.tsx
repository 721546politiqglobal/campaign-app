'use client';

import { useTranslations } from 'next-intl';
import { useToast } from '@/components/Toast';
import { CopyIcon } from '@/components/icons';

/** Icon button that copies `text` to the clipboard and toasts. */
export function CopyButton({ text, label, copiedMessage }: { text: string; label: string; copiedMessage: string }) {
  const t = useTranslations('admin.common');
  const { toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast(copiedMessage, 'success');
    } catch {
      toast(t('genericError'), 'error');
    }
  }
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={copy} aria-label={label} title={label}>
      <CopyIcon size={14} />
    </button>
  );
}
