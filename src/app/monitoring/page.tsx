import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { MonitoringTable } from '@/components/MonitoringTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/session';
import { getMonitoringResults } from '@/lib/data';
import { MonitoringAddForm } from './MonitoringAddForm';

export default async function Monitoring() {
  const t = await getTranslations('monitoring');
  const s = await requireSession();
  const results = await getMonitoringResults(s.campaignId);

  return (
    <AppFrame>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

      <div className="stack mon-page">
        <MonitoringTable results={results} />

        <section className="card card-sectioned" aria-labelledby="mon-add-heading">
          <div className="card-header">
            <div className="card-header-text">
              <h2 id="mon-add-heading">{t('addManually.heading')}</h2>
              <p className="card-header-desc">{t('addManually.description')}</p>
            </div>
          </div>
          <div className="card-body">
            <MonitoringAddForm />
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
