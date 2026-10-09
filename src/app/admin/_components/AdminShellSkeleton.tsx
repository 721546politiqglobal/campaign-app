/**
 * Route-level loading fallback for /admin/**. Only the page content is a
 * skeleton: admin/layout.tsx (AdminFrame) already renders the real sidebar
 * around every loading.tsx, so rendering a shell here would nest a second,
 * skeleton sidebar inside the real one. Page content goes in `children`.
 */
export function AdminShellSkeleton({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Skeleton for a PageHeader (eyebrow + title + optional action). */
export function HeaderSkeleton({ action }: { action?: boolean }) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <div className="skeleton admin-skel-eyebrow" />
        <div className="skeleton admin-skel-title" />
        <div className="skeleton admin-skel-desc" />
      </div>
      {action && <div className="skeleton admin-skel-action" />}
    </div>
  );
}

/** Skeleton for a `.table-wrap` card with `rows` rows. */
export function TableSkeleton({ rows = 6, toolbar = true }: { rows?: number; toolbar?: boolean }) {
  return (
    <>
      {toolbar && <div className="admin-toolbar"><div className="skeleton admin-skel-search" /></div>}
      <div className="card card-sectioned">
        <div className="admin-skel-row admin-skel-head">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" />)}
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="admin-skel-row">
            {[0, 1, 2, 3].map(j => <div key={j} className="skeleton" />)}
          </div>
        ))}
      </div>
    </>
  );
}

/** Skeleton for a form/settings card. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card">
      <div className="skeleton admin-skel-card-title" />
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton admin-skel-card-line" />)}
    </div>
  );
}
