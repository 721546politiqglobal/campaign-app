import Link from 'next/link';
import { getAllUsersAdmin } from '@/lib/data';
import { impersonateAction } from '../actions';

export default async function AdminUsers() {
  const users = await getAllUsersAdmin();
  const campaignUsers = users.filter(u => u.role !== 'super_admin');

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">People</span>
          <h1>All users</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>{campaignUsers.length} users across all campaigns</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Campaign</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaignUsers.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13.5 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{u.id}</div>
                </td>
                <td>
                  <span className="pill"
                    style={u.role === 'owner'
                      ? { borderColor: 'rgba(249,115,22,0.3)', color: 'var(--accent)' }
                      : {}}>
                    {u.role}
                  </span>
                </td>
                <td>
                  {u.campaignName ? (
                    <Link href={`/admin/campaigns/${u.campaignId}`}
                      style={{ color: 'var(--text-2)', fontSize: 13, textDecoration: 'none' }}
                      className="hover-accent">
                      {u.campaignName}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <form action={impersonateAction.bind(null, u.id)}>
                    <button className="admin-impersonate-btn" type="submit">Sign in as</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
