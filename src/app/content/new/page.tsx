import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { ContentEditor } from '@/components/ContentEditor';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/lib/locale';

export default async function NewContent() {
  const t = await getTranslations('content');
  const s = await requireSession();
  const profile = await getCandidateProfile(s.campaignId);
  const defaultLocale = isSupportedLocale(profile?.contentLocale) ? profile.contentLocale : DEFAULT_LOCALE;
  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('create')}</span><h1>{t('newContent')}</h1></div>
      </div>
      <Suspense>
        <ContentEditor defaultLocale={defaultLocale} />
      </Suspense>
    </AppFrame>
  );
}
