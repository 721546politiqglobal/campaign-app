import { AdminShellSkeleton, HeaderSkeleton, TableSkeleton } from './_components/AdminShellSkeleton';

export default function AdminOverviewLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton action />
        <div className="admin-stat-grid">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card card-sm stat">
              <div className="skeleton admin-skel-eyebrow" />
              <div className="skeleton admin-skel-stat" />
            </div>
          ))}
        </div>
        <div className="skeleton admin-skel-card-title" />
        <TableSkeleton rows={5} toolbar={false} />
      </div>
    </AdminShellSkeleton>
  );
}
