import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function SettingsLoading() {
  return (
    <AppShellSkeleton>
      <div className="pagehead">
        <div>
          <div className="skeleton" style={{ width: 110, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 120, height: 26 }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="skeleton" style={{ width: 140, height: 14, marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ width: 90, height: 9, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '100%', height: 36, borderRadius: 7 }} />
            </div>
          ))}
        </div>
        <div className="skeleton" style={{ width: '100%', height: 72, borderRadius: 7, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: 120, height: 36, borderRadius: 7 }} />
      </div>

      <div className="grid cols-2">
        <div className="card"><div className="skeleton" style={{ width: '100%', height: 90, borderRadius: 8 }} /></div>
        <div className="card"><div className="skeleton" style={{ width: '100%', height: 90, borderRadius: 8 }} /></div>
      </div>
    </AppShellSkeleton>
  );
}
