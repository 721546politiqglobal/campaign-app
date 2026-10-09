'use client';

import { useTranslations } from 'next-intl';
import { SubmitButton } from '@/components/SubmitButton';
import { deleteBillingPlanAction, syncBillingPlansAction } from './actions';
import { ActionForm } from '../_components/ActionForm';
import { ConfirmActionButton } from '../_components/ConfirmActionButton';

/** "Sync starter plans" button with pending + toast feedback. */
export function SyncPlansForm() {
  const t = useTranslations('admin.billing');
  return (
    <ActionForm action={() => syncBillingPlansAction()} successMessage={t('synced')}>
      <SubmitButton variant="secondary" pendingText={t('syncingButton')}>{t('syncButton')}</SubmitButton>
    </ActionForm>
  );
}

/** Delete a non-core plan after confirmation. */
export function DeletePlanButton({ plan }: { plan: { id: string; name: string } }) {
  const t = useTranslations('admin.billing');
  return (
    <ConfirmActionButton
      size="sm"
      variant="danger-soft"
      pendingText={t('deletingButton')}
      successMessage={t('deleted')}
      action={() => {
        const fd = new FormData();
        fd.set('id', plan.id);
        return deleteBillingPlanAction(fd);
      }}
      confirm={{
        title: t('deleteTitle', { name: plan.name }),
        description: t('deleteDesc'),
        confirmLabel: t('deleteConfirm'),
        tone: 'danger',
      }}
    >
      {t('deletePlanButton')}
    </ConfirmActionButton>
  );
}
