import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { InfoIcon } from '@/components/icons';
import { requireSession } from '@/lib/session';
import { getCampaign } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { can } from '@/lib/permissions';
import { getTheme } from '@/lib/theme';
import { PARTIES } from '@/lib/profile-validation';
// users.locale deliberately has no CHECK constraint (adding a language should
// not need a migration), so validate the column rather than asserting it.
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from '@/lib/locale';
import type { CandidateProfile } from '@/domain/types';
import { ProfileForm, type SelectOption } from './ProfileForm';
import { DisclosureForm } from './DisclosureForm';

const VOICE_TONES = ['conversational', 'formal', 'urgent', 'inspirational'] as const;

function profileFormValues(profile: CandidateProfile | null): Record<string, string> {
  return {
    full_name:       profile?.fullName ?? '',
    preferred_name:  profile?.preferredName ?? '',
    office:          profile?.office ?? '',
    district:        profile?.district ?? '',
    party:           profile?.party ?? '',
    opponent_name:   profile?.opponentName ?? '',
    bio:             profile?.bio ?? '',
    tagline:         profile?.tagline ?? '',
    target_audience: profile?.targetAudience ?? '',
    key_positions:   profile?.keyPositions.join('\n') ?? '',
    voice_tone:      profile?.voiceTone ?? 'conversational',
    content_locale:  isSupportedLocale(profile?.contentLocale) ? profile.contentLocale : DEFAULT_LOCALE,
    opponent_aliases:    profile?.opponentAliases.join(', ') ?? '',
    monitoring_keywords: profile?.monitoringKeywords.join(', ') ?? '',
    opponent_twitter_handle:   profile?.opponentTwitterHandle ?? '',
    opponent_instagram_handle: profile?.opponentInstagramHandle ?? '',
    opponent_facebook_page:    profile?.opponentFacebookPage ?? '',
    google_alerts_rss_url:     profile?.googleAlertsRssUrl ?? '',
  };
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card card-sectioned" aria-labelledby={`${id}-heading`}>
      <div className="card-header">
        <div className="card-header-text">
          <h2 id={`${id}-heading`}>{title}</h2>
          {description && <span className="card-header-desc">{description}</span>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Row({ label, value, emptyLabel }: { label: string; value: React.ReactNode; emptyLabel: string }) {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  return (
    <>
      <dt>{label}</dt>
      <dd className={empty ? 'is-empty' : undefined}>{empty ? emptyLabel : value}</dd>
    </>
  );
}

export default async function Settings() {
  const t = await getTranslations('settings');
  const tc = await getTranslations('common');
  const s = await requireSession();
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');
  const emptyLabel = '—';

  const partyOptions: SelectOption[] = PARTIES.map(p => ({ value: p, label: tc(`parties.${p.toLowerCase()}`) }));
  const toneOptions: SelectOption[] = VOICE_TONES.map(v => ({ value: v, label: t(`profile.voiceToneOptions.${v}`) }));
  const localeOptions: SelectOption[] = SUPPORTED_LOCALES.map(l => ({
    value: l, label: l === 'es' ? tc('languageSpanish') : tc('languageEnglish'),
  }));
  const values = profileFormValues(profile);
  const partyLabel = profile?.party && PARTIES.some(p => p === profile.party) ? tc(`parties.${profile.party.toLowerCase()}`) : profile?.party ?? '';
  const toneLabel = profile ? t(`profile.voiceToneOptions.${profile.voiceTone}`) : '';
  const contentLocaleLabel = localeOptions.find(o => o.value === values.content_locale)?.label ?? '';

  return (
    <AppFrame>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

      <div className="stack">
        {!canEdit && (
          <div className="alert alert-info">
            <InfoIcon size={16} />
            <div className="alert-body">
              <div className="alert-title">{t('readOnly.title')}</div>
              <div className="alert-text">{t('readOnly.body')}</div>
            </div>
          </div>
        )}

        <Section id="profile" title={t('profile.heading')} description={t('profile.description')}>
          {canEdit ? (
            <ProfileForm initialValues={values} partyOptions={partyOptions} toneOptions={toneOptions} localeOptions={localeOptions} />
          ) : (
            <dl className="acct-dl">
              <Row label={t('profile.fields.fullName')} value={values.full_name} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.preferredName')} value={values.preferred_name} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.office')} value={values.office} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.district')} value={values.district} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.party')} value={partyLabel} emptyLabel={t('profile.fields.partyNone')} />
              <Row label={t('profile.fields.primaryOpponent')} value={values.opponent_name} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.bio')} value={values.bio} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.tagline')} value={values.tagline} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.targetAudience')} value={values.target_audience} emptyLabel={emptyLabel} />
              <Row
                label={t('profile.fields.keyPositions')}
                value={profile?.keyPositions.length ? <ul className="acct-list">{profile.keyPositions.map((k, i) => <li key={i}>{k}</li>)}</ul> : ''}
                emptyLabel={emptyLabel}
              />
              <Row label={t('profile.fields.voiceTone')} value={toneLabel} emptyLabel={emptyLabel} />
              <Row label={t('profile.fields.contentLocale')} value={contentLocaleLabel} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.opponentAliases')} value={values.opponent_aliases} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.monitoringKeywords')} value={values.monitoring_keywords} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.opponentTwitter')} value={values.opponent_twitter_handle} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.opponentInstagram')} value={values.opponent_instagram_handle} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.opponentFacebook')} value={values.opponent_facebook_page} emptyLabel={emptyLabel} />
              <Row label={t('profile.monitoring.googleAlertsRssUrl')} value={values.google_alerts_rss_url} emptyLabel={emptyLabel} />
            </dl>
          )}
        </Section>

        <Section id="content-defaults" title={t('disclosure.sectionHeading')}>
          {canEdit ? (
            <DisclosureForm initialValue={campaign?.defaultDisclosureText ?? ''} />
          ) : (
            <dl className="acct-dl">
              <Row label={t('disclosure.heading')} value={campaign?.defaultDisclosureText ?? ''} emptyLabel={t('disclosure.placeholder')} />
            </dl>
          )}
        </Section>

        <Section id="campaign" title={t('campaign.heading')} description={t('campaign.description')}>
          <dl className="acct-dl">
            <Row label={t('campaign.name')} value={campaign?.name ?? ''} emptyLabel={emptyLabel} />
            <Row
              label={t('campaign.jurisdictions')}
              value={campaign?.jurisdictions.length
                ? <div className="btnrow">{campaign.jurisdictions.map(j => <Badge key={j} tone="info">{j}</Badge>)}</div>
                : ''}
              emptyLabel={t('campaign.noJurisdictions')}
            />
          </dl>
        </Section>

        <Section id="preferences" title={t('preferences.heading')} description={t('preferences.description')}>
          <div className="acct-pref">
            <div className="acct-pref-text">
              <strong>{t('preferences.languageTitle')}</strong>
              <p>{t('preferences.languageBody')}</p>
            </div>
            <div className="acct-pref-control">
              <LanguageSwitcher currentLocale={isSupportedLocale(s.locale) ? s.locale : DEFAULT_LOCALE} />
            </div>
          </div>
          <div className="acct-pref">
            <div className="acct-pref-text">
              <strong>{t('preferences.themeTitle')}</strong>
              <p>{t('preferences.themeBody')}</p>
            </div>
            <div className="acct-pref-control">
              <ThemeToggle current={getTheme()} />
            </div>
          </div>
        </Section>
      </div>
    </AppFrame>
  );
}
