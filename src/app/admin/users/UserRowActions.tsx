'use client';

import { useTranslations } from 'next-intl';
import { impersonateAction, removeUserAction } from '../actions';
import { ConfirmActionButton } from '../_components/ConfirmActionButton';

/** Impersonate / remove buttons for one user row — both confirm first. */
export function UserRowActions({ user }: { user: { id: string; name: string; campaignId: string | null } }) {
  const t = useTranslations('admin.users');
  return (
    <div className="table-actions">
      {user.campaignId && (
        <ConfirmActionButton
          size="sm"
          action={() => impersonateAction(user.id)}
          pendingText={t('signingIn')}
          confirm={{
            title: t('impersonateTitle', { name: user.name }),
            description: t('impersonateDesc'),
            confirmLabel: t('impersonateConfirm'),
          }}
        >
          {t('signInAs')}
        </ConfirmActionButton>
      )}
      {user.campaignId && (
        <ConfirmActionButton
          size="sm"
          variant="danger-soft"
          action={() => removeUserAction(user.id, user.campaignId as string)}
          pendingText={t('removing')}
          successMessage={t('removed')}
          confirm={{
            title: t('removeTitle', { name: user.name }),
            description: t('removeDesc'),
            confirmLabel: t('removeConfirm'),
            tone: 'danger',
          }}
        >
          {t('remove')}
        </ConfirmActionButton>
      )}
    </div>
  );
}
