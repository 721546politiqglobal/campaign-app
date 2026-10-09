import { AdminShellSkeleton, HeaderSkeleton, TableSkeleton } from '../_components/AdminShellSkeleton';

export default function AdminContentLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton />
        <div className="skeleton admin-skel-tabs" />
        <TableSkeleton rows={10} />
      </div>
    </AdminShellSkeleton>
  );
}
