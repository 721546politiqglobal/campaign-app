import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function DashboardLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton sk sk-eyebrow" />
          <div className="skeleton sk sk-title" />
        </div>
        <div className="page-header-actions">
          <div className="skeleton sk sk-btn" />
          <div className="skeleton sk sk-btn" />
        </div>
      </div>

      <div className="stack dash-stack">
        <div className="grid cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card card-sm stat">
              <div className="stat-header">
                <div className="skeleton sk sk-text sk-w-50" />
                <div className="skeleton sk sk-icon" />
              </div>
              <div className="skeleton sk sk-stat" />
              <div className="skeleton sk sk-text sk-w-75" />
            </div>
          ))}
        </div>

        <div className="dash-grid">
          <div className="card card-sectioned">
            <div className="card-header"><div className="skeleton sk sk-heading" /></div>
            <ul className="dash-list">
              {[0, 1, 2, 3].map(i => (
                <li key={i} className="dash-list-row">
                  <span className="dash-list-main">
                    <div className="skeleton sk sk-text sk-w-50" />
                    <div className="skeleton sk sk-text-xs sk-w-25" />
                  </span>
                  <div className="skeleton sk sk-pill" />
                </li>
              ))}
            </ul>
          </div>
          <div className="card card-sectioned">
            <div className="card-header"><div className="skeleton sk sk-heading" /></div>
            <ul className="dash-pulse">
              {[0, 1, 2].map(i => (
                <li key={i} className="dash-pulse-item">
                  <div className="skeleton sk sk-text-xs sk-w-25" />
                  <div className="skeleton sk sk-text sk-w-100" />
                  <div className="skeleton sk sk-text sk-w-75" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
