import { AdminShellSkeleton, HeaderSkeleton, TableSkeleton } from '../_components/AdminShellSkeleton';

export default function AdminCampaignsLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton action />
        <div className="skeleton admin-skel-tabs" />
        <TableSkeleton rows={8} />
      </div>
    </AdminShellSkeleton>
  );
}
