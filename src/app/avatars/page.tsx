import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
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

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('eyebrow')}</span><h1>{t('title')}</h1></div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 6 }}>{t('avatarsHeading')}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          {t('avatarsDescription')}
        </p>
        <AvatarManager
          avatars={avatars}
          activeAvatarId={profile?.activeAvatarId ?? null}
          canManage={canManageAvatars}
        />
        {profile?.heygenBaseAvatarId && (
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
            <AvatarLibrary
              baseAvatarId={profile.heygenBaseAvatarId}
              currentAvatarId={profile?.heygenAvatarId}
              currentAspectRatio={profile?.videoAspectRatio}
            />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 6 }}>{t('voiceHeading')}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          {t('voiceDescription')}
        </p>
        <VoiceCloneManager
          status={profile?.selfVoiceCloneStatus ?? null}
          name={profile?.selfVoiceName ?? null}
          error={profile?.selfVoiceCloneError ?? null}
          canManage={canManageAvatars}
        />
      </div>
    </AppFrame>
  );
}
