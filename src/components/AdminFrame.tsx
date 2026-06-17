import { requireAdmin } from '@/lib/session';
import { AdminSidebar } from './AdminSidebar';

export function AdminFrame({ children }: { children: React.ReactNode }) {
  const s = requireAdmin();
  return (
    <div className="shell">
      <AdminSidebar name={s.name} />
      <main className="main">{children}</main>
    </div>
  );
}
