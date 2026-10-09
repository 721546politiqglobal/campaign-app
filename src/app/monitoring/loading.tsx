import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function MonitoringLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton ai-sk-eyebrow" />
          <div className="skeleton ai-sk-title" />
          <div className="skeleton ai-sk-desc" />
        </div>
      </div>

      <div className="stack">
        <div className="mon-toolbar">
          <div className="skeleton ai-sk-segmented" />
          <div className="skeleton ai-sk-chip" />
        </div>

        <ul className="mon-list">
          {[0, 1, 2, 3].map(i => (
            <li key={i} className="card mon-card">
              <div className="mon-card-head">
                <div className="mon-card-meta">
                  <div className="skeleton ai-sk-text-md" />
                  <div className="skeleton ai-sk-badge" />
                  <div className="skeleton ai-sk-badge" />
                </div>
                <div className="skeleton ai-sk-text-sm" />
              </div>
              <div className="skeleton ai-sk-line" />
              <div className="skeleton ai-sk-line ai-sk-line-85" />
              <div className="mon-card-actions">
                <div className="skeleton ai-sk-btn" />
                <div className="skeleton ai-sk-btn" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppShellSkeleton>
  );
}
