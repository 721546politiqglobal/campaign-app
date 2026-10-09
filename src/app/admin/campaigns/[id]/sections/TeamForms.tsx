'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { addUserAction, generateInviteAction } from '../../../actions';
import { ActionForm } from '../../../_components/ActionForm';

export interface RoleOption { value: string; label: string }

/** "Add & invite" form (client; the page passes translated role options). */
export function AddUserForm({ campaignId, roles }: { campaignId: string; roles: RoleOption[] }) {
  const t = useTranslations('admin.campaigns.detail');
  const tUsers = useTranslations('admin.users');
  return (
    <ActionForm action={addUserAction} successMessage={t('userAdded')}>
      {({ values }) => (
        <div className="stack">
          <h3>{t('addUserHeading')}</h3>
          <div className="admin-inline-form">
            <input type="hidden" name="campaignId" value={campaignId} />
            <Field label={tUsers('colName')} required>
              {p => <input {...p} name="name" className="input" placeholder={t('addUserNamePlaceholder')} defaultValue={values.name ?? ''} required maxLength={120} />}
            </Field>
            <Field label={tUsers('colEmail')} required>
              {p => <input {...p} type="email" name="email" className="input" placeholder={t('addUserEmailPlaceholder')} defaultValue={values.email ?? ''} required maxLength={254} />}
            </Field>
            <Field label={tUsers('colRole')} className="field-narrow">
              {p => (
                <select {...p} name="role" className="input" defaultValue={values.role ?? 'staff'}>
                  {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              )}
            </Field>
            <SubmitButton pendingText={t('addingUser')}>{t('addAndInviteButton')}</SubmitButton>
          </div>
          <p className="subtle text-sm">{t('addUserHelperText')}</p>
        </div>
      )}
    </ActionForm>
  );
}

/** "Generate invite link" form. */
export function GenerateInviteForm({ campaignId, roles }: { campaignId: string; roles: RoleOption[] }) {
  const t = useTranslations('admin.campaigns.detail');
  const tUsers = useTranslations('admin.users');
  return (
    <ActionForm action={generateInviteAction} successMessage={t('inviteGenerated')} className="admin-inline-form">
      <input type="hidden" name="campaignId" value={campaignId} />
      <Field label={tUsers('colRole')} className="field-narrow">
        {p => (
          <select {...p} name="role" className="input" defaultValue="staff">
            {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
      </Field>
      <SubmitButton variant="secondary" pendingText={t('generatingInvite')}>{t('generateInviteButton')}</SubmitButton>
    </ActionForm>
  );
}
