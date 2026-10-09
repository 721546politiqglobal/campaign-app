'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { PlusIcon } from '@/components/icons';
import { createCampaignAction } from '../actions';
import { ActionForm } from '../_components/ActionForm';

/**
 * "New campaign" button + dialog. `defaultOpen` (from `?new=1`, e.g. the
 * overview's CTA) opens it on load; closing it cleans the query string so a
 * refresh doesn't reopen it. On success the action redirects to the campaign.
 */
export function NewCampaignDialog({ defaultOpen }: { defaultOpen?: boolean }) {
  const t = useTranslations('admin.campaigns');
  const tCommon = useTranslations('admin.common');
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);

  function close() {
    setOpen(false);
    if (defaultOpen) router.replace('/admin/campaigns');
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <PlusIcon size={16} />{t('newCampaign')}
      </button>
      <Dialog open={open} onClose={close} title={t('createDialogTitle')} description={t('createDialogDesc')}>
        <ActionForm action={createCampaignAction}>
          {({ values }) => (
            <div className="stack">
              <Field label={t('campaignNameLabel')} required>
                {p => <input {...p} name="name" className="input" placeholder={t('campaignNamePlaceholder')} defaultValue={values.name ?? ''} required maxLength={120} autoFocus />}
              </Field>
              <Field label={t('jurisdictionsLabel')} hint={t('jurisdictionsHint')}>
                {p => <input {...p} name="jurisdictions" className="input" placeholder={t('jurisdictionsPlaceholder')} defaultValue={values.jurisdictions ?? 'US-FEDERAL'} />}
              </Field>
              <div className="form-actions">
                <button type="button" className="btn" onClick={close}>{tCommon('cancel')}</button>
                <SubmitButton pendingText={t('creatingButton')}>{t('createButton')}</SubmitButton>
              </div>
            </div>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
