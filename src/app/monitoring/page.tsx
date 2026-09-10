import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { MonitoringTable } from '@/components/MonitoringTable';
import { requireSession } from '@/lib/session';
import { getMonitoringResults } from '@/lib/data';
import { revalidatePath } from 'next/cache';

async function addManualEntryAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const s = await requireSession();
  const url      = String(formData.get('url')      ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const source   = String(formData.get('source')   ?? '').trim();
  if (!headline || !source) return;
  const { adminDb } = await import('@/lib/supabase');
  const { uid }     = await import('@/lib/store');
  const { scoreCredibility, categorizeSource } = await import('@/lib/credibility');
  await adminDb.from('monitoring_results').insert({
    id: uid(),
    campaign_id: s.campaignId,
    source,
    excerpt: headline,
    url: url || '',
    captured_at: new Date().toISOString(),
    credibility: scoreCredibility(url),
    category:    categorizeSource(url, source),
  });
  revalidatePath('/monitoring');
}

export default async function Monitoring() {
  const t = await getTranslations('monitoring');
  const s = await requireSession();
  const results = await getMonitoringResults(s.campaignId);

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('eyebrow')}</span><h1>{t('title')}</h1></div>
      </div>

      <MonitoringTable results={results} />

      {/* Manual entry */}
      <div className="card" style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 12 }}>{t('addManually.heading')}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          {t('addManually.description')}
        </p>
        <form action={addManualEntryAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">{t('addManually.headlineLabel')}</label>
              <input name="headline" className="input" required placeholder={t('addManually.headlinePlaceholder')} />
            </div>
            <div>
              <label className="field-label">{t('addManually.sourceLabel')}</label>
              <input name="source" className="input" required placeholder={t('addManually.sourcePlaceholder')} />
            </div>
          </div>
          <div>
            <label className="field-label">{t('addManually.urlLabel')}</label>
            <input name="url" className="input" placeholder="https://..." />
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>{t('addManually.submitButton')}</button>
        </form>
      </div>
    </AppFrame>
  );
}
