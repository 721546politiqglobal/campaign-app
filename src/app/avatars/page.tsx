import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { listAvatars } from '@/lib/avatars';
import { AvatarLibrary } from '@/components/AvatarLibrary';
import { AvatarManager } from '@/components/AvatarManager';
import { VoiceCloneManager } from '@/components/VoiceCloneManager';
import { can } from '@/lib/permissions';

export default async function AvatarsPage() {
  const s = await requireSession();
  const t = await getTranslations('avatars');
  const [profile, avatars] = await Promise.all([
    getCandidateProfile(s.campaignId),
    listAvatars(s.campaignId),
  ]);
  const canManageAvatars = can(s.role, 'manage_avatars');
  const canEditSettings = can(s.role, 'edit_settings');

  return (
    <AppFrame>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

      <div className="stack av-page">
        <section className="card card-sectioned" aria-labelledby="av-avatars-heading">
          <div className="card-header">
            <div className="card-header-text">
              <h2 id="av-avatars-heading">{t('avatarsHeading')}</h2>
              <p className="card-header-desc">{t('avatarsDescription')}</p>
            </div>
          </div>
          <div className="card-body">
            <AvatarManager
              avatars={avatars}
              activeAvatarId={profile?.activeAvatarId ?? null}
              canManage={canManageAvatars}
            />
          </div>
        </section>

        <section className="card card-sectioned" aria-labelledby="av-voice-heading">
          <div className="card-header">
            <div className="card-header-text">
              <h2 id="av-voice-heading">{t('voiceHeading')}</h2>
              <p className="card-header-desc">{t('voiceDescription')}</p>
            </div>
          </div>
          <div className="card-body">
            <VoiceCloneManager
              status={profile?.selfVoiceCloneStatus ?? null}
              name={profile?.selfVoiceName ?? null}
              error={profile?.selfVoiceCloneError ?? null}
              canManage={canManageAvatars}
            />
          </div>
        </section>

        <section className="card card-sectioned" aria-labelledby="av-video-heading">
          <div className="card-header">
            <div className="card-header-text">
              <h2 id="av-video-heading">{t('videoSettingsHeading')}</h2>
              <p className="card-header-desc">{t('videoSettingsDescription')}</p>
            </div>
          </div>
          <div className="card-body">
            {/* Always rendered: the aspect ratio must be reachable before any
                avatar has finished training (the content wizard links here). */}
            <AvatarLibrary
              baseAvatarId={profile?.heygenBaseAvatarId ?? null}
              currentAvatarId={profile?.heygenAvatarId}
              currentAspectRatio={profile?.videoAspectRatio}
              canManage={canEditSettings}
            />
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
