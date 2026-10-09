import { AdminShellSkeleton, HeaderSkeleton, TableSkeleton } from '../_components/AdminShellSkeleton';

export default function AdminUsersLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton />
        <TableSkeleton rows={10} />
      </div>
    </AdminShellSkeleton>
  );
}
