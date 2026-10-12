import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { ContentEditor } from '@/components/ContentEditor';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/lib/locale';
import { getMonitoringItemForCampaign } from '@/lib/data';

export default async function NewContent({ searchParams }: { searchParams: { respondTo?: string } }) {
  const t = await getTranslations('content');
  const s = await requireSession();
  const [profile, story] = await Promise.all([
    getCandidateProfile(s.campaignId),
    // "Draft rebuttal" from Monitoring: scoped to the caller's campaign.
    searchParams.respondTo ? getMonitoringItemForCampaign(s.campaignId, searchParams.respondTo) : Promise.resolve(null),
  ]);
  const defaultLocale = isSupportedLocale(profile?.contentLocale) ? profile.contentLocale : DEFAULT_LOCALE;
  return (
    <AppFrame>
      <PageHeader
        eyebrow={t('create')}
        title={t('newContent')}
        description={t('newDescription')}
        breadcrumb={[{ label: t('pageTitle'), href: '/content' }, { label: t('newContent') }]}
        breadcrumbLabel={t('breadcrumbLabel')}
      />
      <Suspense>
        <ContentEditor
          defaultLocale={defaultLocale}
          respondTo={story ? { id: story.id, source: story.source, excerpt: story.excerpt, url: story.url } : undefined}
        />
      </Suspense>
    </AppFrame>
  );
}
