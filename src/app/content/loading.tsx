import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function ContentListLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton sk sk-eyebrow" />
          <div className="skeleton sk sk-title" />
        </div>
        <div className="page-header-actions">
          <div className="skeleton sk sk-btn" />
        </div>
      </div>

      <div className="tabs" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className="content-skel-tab"><div className="skeleton sk sk-text sk-w-100" /></span>
        ))}
      </div>

      <div className="card flush">
        <ul className="content-skel-rows">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="content-skel-row">
              <div className="skeleton sk sk-text content-skel-cell-wide" />
              <div className="skeleton sk sk-text-xs content-skel-cell" />
              <div className="skeleton sk sk-text-xs content-skel-cell" />
              <div className="skeleton sk sk-text-xs content-skel-cell" />
              <div className="skeleton sk sk-pill" />
            </li>
          ))}
        </ul>
      </div>
    </AppShellSkeleton>
  );
}
