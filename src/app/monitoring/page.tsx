import { AppFrame } from '@/components/AppFrame';
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
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Source</th><th>Subject</th><th>Excerpt</th></tr></thead>
          <tbody>
            {results.map(m => (
              <tr className="row" key={m.id}>
                <td className="muted">{m.source}</td>
                <td>{m.opponent ?? '—'}</td>
                <td><a href={m.url} className="linkcell" target="_blank" rel="noopener noreferrer">{m.excerpt}</a></td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ padding: 24 }}>No monitoring results yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}
