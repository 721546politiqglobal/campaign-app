import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { PARTIES } from '@/lib/profile-validation';
import { upsertProfileAction } from './actions';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const t = await getTranslations('setup');
  const s = await requireSession();
  const existing = await getCandidateProfile(s.campaignId);
  if (existing) redirect('/dashboard');

  const TONES = [
    ['conversational', t('tones.conversational')],
    ['formal',         t('tones.formal')],
    ['urgent',         t('tones.urgent')],
    ['inspirational',  t('tones.inspirational')],
  ] as const;

  return (
    <div className="setup-wrap">
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div className="setup-brand">
          <img src="/politiq-logo.png" alt="PolitIQ" className="login-logo-img" />
        </div>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1 style={{ margin: '6px 0 8px' }}>{t('title')}</h1>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {t('description')}
          </p>
        </div>

        {searchParams.error === 'required' && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div>
              <div className="t">{t('requiredFieldsTitle')}</div>
              <div className="b">{t('requiredFieldsBody')}</div>
            </div>
          </div>
        )}

        {searchParams.error === 'party' && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div>
              <div className="t">{t('partyErrorTitle')}</div>
              <div className="b">{t('partyErrorBody')}</div>
            </div>
          </div>
        )}

        <form action={upsertProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>{t('candidateHeading')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">{t('fields.fullName')}</label>
                <input name="full_name" className="input" placeholder={t('fields.fullNamePlaceholder')} required />
              </div>
              <div>
                <label className="field-label">{t('fields.preferredName')}</label>
                <input name="preferred_name" className="input" placeholder={t('fields.preferredNamePlaceholder')} required />
              </div>
              <div>
                <label className="field-label">{t('fields.office')}</label>
                <input name="office" className="input" placeholder={t('fields.officePlaceholder')} required />
              </div>
              <div>
                <label className="field-label">{t('fields.district')}</label>
                <input name="district" className="input" placeholder={t('fields.districtPlaceholder')} required />
              </div>
              <div>
                <label className="field-label">{t('fields.party')}</label>
                <select name="party" className="input" defaultValue="">
                  <option value="">—</option>
                  {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">{t('fields.primaryOpponent')}</label>
                <input name="opponent_name" className="input" placeholder={t('fields.opponentNamePlaceholder')} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label">{t('fields.photoUrl')}</label>
              <input name="photo_url" className="input" placeholder={t('fields.photoUrlPlaceholder')} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 16 }}>{t('voiceHeading')}</h2>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">{t('bioLabel')}</label>
              <textarea name="bio" className="input" style={{ minHeight: 80 }}
                placeholder={t('bioPlaceholder')} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">{t('taglineLabel')}</label>
              <input name="tagline" className="input" placeholder={t('taglinePlaceholder')} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">{t('targetAudienceLabel')}</label>
              <input name="target_audience" className="input" placeholder={t('targetAudiencePlaceholder')} />
            </div>
            <div>
              <label className="field-label">{t('keyPositionsLabel')}</label>
              <textarea name="key_positions" className="input" style={{ minHeight: 120 }}
                placeholder={t('keyPositionsPlaceholder')} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 12 }}>{t('toneHeading')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TONES.map(([value, label]) => (
                <label key={value} className="tone-option">
                  <input type="radio" name="voice_tone" value={value} defaultChecked={value === 'conversational'} />
                  <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="btn primary" style={{ alignSelf: 'flex-end', padding: '12px 28px', fontSize: 15 }}>
            {t('submitButton')}
          </button>
        </form>
      </div>
    </div>
  );
}
