import { AdminShellSkeleton, HeaderSkeleton, TableSkeleton } from '../_components/AdminShellSkeleton';

export default function AdminAuditLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton />
        <TableSkeleton rows={12} />
      </div>
    </AdminShellSkeleton>
  );
}
