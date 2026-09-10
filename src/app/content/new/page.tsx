import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { ContentEditor } from '@/components/ContentEditor';

export default async function NewContent() {
  const t = await getTranslations('content');
  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('create')}</span><h1>{t('newContent')}</h1></div>
      </div>
      <Suspense>
        <ContentEditor />
      </Suspense>
    </AppFrame>
  );
}
