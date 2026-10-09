'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { assignAvatarAction, assignVoiceAction } from '../../../actions';
import { ActionForm } from '../../../_components/ActionForm';

export interface AvatarVoiceCardProps {
  campaignId: string;
  heygenBaseAvatarId: string | null;
  heygenVoiceId: string | null;
  avatarCount: number;
}

export function AvatarVoiceCard({ campaignId, heygenBaseAvatarId, heygenVoiceId, avatarCount }: AvatarVoiceCardProps) {
  const t = useTranslations('admin.campaigns.detail');
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t('avatarHeading')}</h2>
          <p className="muted text-sm">{t('avatarDesc')}</p>
        </div>
      </div>

      <div className="admin-detail-grid">
        <div className="stack">
          <h3>{t('candidateAvatarHeading')}</h3>
          <p className="muted text-sm">{t.rich('avatarIntro', { strong })}</p>
          <ActionForm action={assignAvatarAction} successMessage={t('avatarAssigned')}>
            {({ values }) => (
              <div className="stack">
                <input type="hidden" name="campaignId" value={campaignId} />
                <Field label={t('heygenAvatarGroupIdLabel')} required>
                  {p => <input {...p} name="heygen_base_avatar_id" className="input mono" placeholder={t('avatarIdPlaceholder')} defaultValue={values.heygen_base_avatar_id ?? ''} required maxLength={120} />}
                </Field>
                <label className="checkrow text-sm">
                  <input type="checkbox" name="consent" required />
                  <span>{t('consentAvatarLabel')}</span>
                </label>
                <div className="form-actions">
                  <SubmitButton pendingText={t('assigningAvatar')}>{t('assignAvatarButton')}</SubmitButton>
                </div>
              </div>
            )}
          </ActionForm>
          {heygenBaseAvatarId ? (
            <div className="admin-status-line">
              <span className="admin-dot ok" aria-hidden="true" />
              <span className="admin-ok-text text-sm">{t('activeAvatarAssigned')}</span>
              <code className="admin-code">{heygenBaseAvatarId}</code>
            </div>
          ) : avatarCount > 0 ? (
            <div className="admin-status-line">
              <span className="admin-dot warn" aria-hidden="true" />
              <span className="admin-warn-text text-sm">{t('avatarCreatedNotActive')}</span>
            </div>
          ) : (
            <div className="admin-status-line">
              <span className="admin-dot" aria-hidden="true" />
              <span className="subtle text-sm">{t('noAvatarAssigned')}</span>
            </div>
          )}
        </div>

        <div className="stack">
          <h3>{t('candidateVoiceHeading')}</h3>
          <p className="muted text-sm">{t.rich('voiceIntro', { strong })}</p>
          <ActionForm action={assignVoiceAction} successMessage={t('voiceAssignedToast')}>
            {({ values }) => (
              <div className="stack">
                <input type="hidden" name="campaignId" value={campaignId} />
                <Field label={t('heygenVoiceIdLabel')} required>
                  {p => <input {...p} name="heygen_voice_id" className="input mono" placeholder={t('voiceIdPlaceholder')} defaultValue={values.heygen_voice_id ?? ''} required maxLength={120} />}
                </Field>
                <label className="checkrow text-sm">
                  <input type="checkbox" name="consent" required />
                  <span>{t('consentVoiceLabel')}</span>
                </label>
                <div className="form-actions">
                  <SubmitButton pendingText={t('assigningVoice')}>{t('assignVoiceButton')}</SubmitButton>
                </div>
              </div>
            )}
          </ActionForm>
          {heygenVoiceId ? (
            <div className="admin-status-line">
              <span className="admin-dot ok" aria-hidden="true" />
              <span className="admin-ok-text text-sm">{t('voiceAssigned')}</span>
              <code className="admin-code">{heygenVoiceId}</code>
            </div>
          ) : (
            <div className="admin-status-line">
              <span className="admin-dot" aria-hidden="true" />
              <span className="subtle text-sm">{t('noVoiceAssigned')}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
