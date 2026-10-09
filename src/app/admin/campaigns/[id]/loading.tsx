import { AdminShellSkeleton, CardSkeleton, HeaderSkeleton, TableSkeleton } from '../../_components/AdminShellSkeleton';

export default function AdminCampaignDetailLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton />
        <div className="admin-stat-grid">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card card-sm stat">
              <div className="skeleton admin-skel-eyebrow" />
              <div className="skeleton admin-skel-stat" />
            </div>
          ))}
        </div>
        <div className="admin-detail-grid">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </div>
        <CardSkeleton lines={4} />
        <TableSkeleton rows={3} toolbar={false} />
        <TableSkeleton rows={4} toolbar={false} />
      </div>
    </AdminShellSkeleton>
  );
}
