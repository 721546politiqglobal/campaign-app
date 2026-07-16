import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function MonitoringLoading() {
  return (
    <AppShellSkeleton>
      <div className="pagehead">
        <div>
          <div className="skeleton" style={{ width: 80, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 26 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 20 }}>
        {[44, 68, 82, 62, 62, 66].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 34, borderRadius: 7 }} />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div className="skeleton" style={{ width: 90, height: 13 }} />
              <div className="skeleton" style={{ width: 120, height: 18, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 60, height: 18, borderRadius: 6 }} />
            </div>
            <div className="skeleton" style={{ width: '100%', height: 11, marginBottom: 7 }} />
            <div className="skeleton" style={{ width: '85%', height: 11, marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="skeleton" style={{ width: 110, height: 30, borderRadius: 7 }} />
              <div className="skeleton" style={{ width: 100, height: 30, borderRadius: 7 }} />
            </div>
          </div>
        ))}
      </div>
    </AppShellSkeleton>
  );
}
