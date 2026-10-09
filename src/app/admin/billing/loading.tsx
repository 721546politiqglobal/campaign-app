import { AdminShellSkeleton, CardSkeleton, HeaderSkeleton } from '../_components/AdminShellSkeleton';

export default function AdminBillingLoading() {
  return (
    <AdminShellSkeleton>
      <div className="stack">
        <HeaderSkeleton />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
    </AdminShellSkeleton>
  );
}
