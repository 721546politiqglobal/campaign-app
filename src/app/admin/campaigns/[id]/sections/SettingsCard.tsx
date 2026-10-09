'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { updateCampaignAction } from '../../../actions';
import { ActionForm } from '../../../_components/ActionForm';

export function SettingsCard({ campaign }: { campaign: { id: string; name: string; jurisdictions: string[]; tags: string[] } }) {
  const t = useTranslations('admin.campaigns.detail');
  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t('settingsHeading')}</h2>
          <p className="muted text-sm">{t('settingsDesc')}</p>
        </div>
      </div>
      <ActionForm action={updateCampaignAction} successMessage={t('settingsSaved')}>
        {({ values }) => (
          <div className="stack">
            <input type="hidden" name="id" value={campaign.id} />
            <Field label={t('nameLabel')} required>
              {p => <input {...p} name="name" className="input" defaultValue={values.name ?? campaign.name} required maxLength={120} />}
            </Field>
            <Field label={t('jurisdictionsLabel')} hint={t('jurisdictionsHint')}>
              {p => <input {...p} name="jurisdictions" className="input" defaultValue={values.jurisdictions ?? campaign.jurisdictions.join(', ')} />}
            </Field>
            <Field label={t('tagsLabel')} hint={t('tagsHint')}>
              {p => <input {...p} name="tags" className="input" placeholder={t('tagsPlaceholder')} defaultValue={values.tags ?? campaign.tags.join(', ')} />}
            </Field>
            <div className="form-actions">
              <SubmitButton pendingText={t('savingButton')}>{t('saveChangesButton')}</SubmitButton>
            </div>
          </div>
        )}
      </ActionForm>
    </section>
  );
}
