import { AppFrame } from '@/components/AppFrame';
import { MonitoringTable } from '@/components/MonitoringTable';
import { requireSession } from '@/lib/session';
import { getMonitoringResults } from '@/lib/data';

export default async function Monitoring() {
  const s = requireSession();
  const results = await getMonitoringResults(s.campaignId);

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Intelligence</span><h1>Opponent monitoring</h1></div>
      </div>
      {!process.env.NEWSDATA_API_KEY && (
        <div className="banner warn" style={{ marginBottom: 18 }}>
          <div>
            <div className="t">Using seeded data</div>
            <div className="b">
              Add NEWSDATA_API_KEY to .env to enable live polling from GDELT and NewsData.
              Suggested rebuttals pass through the same approval + disclosure gates before publishing.
            </div>
          </div>
        </div>
      )}
      <MonitoringTable results={results} />
    </AppFrame>
  );
}
