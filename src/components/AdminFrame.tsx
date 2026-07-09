import { requireAdmin } from '@/lib/session';
import { AdminSidebar } from './AdminSidebar';

export async function AdminFrame({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  return (
    <div className="shell">
      <AdminSidebar name={s.name} />
      <main className="main">
        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
