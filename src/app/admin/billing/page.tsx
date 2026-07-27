import { redirect } from 'next/navigation';
import { getBillingPlans } from '@/lib/data';
import { syncBillingPlansAction } from './actions';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const plans = await getBillingPlans();

  async function sync() {
    'use server';
    const result = await syncBillingPlansAction();
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Sync failed.'));
    }
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Billing plans</h1>
        </div>
      </div>

      {searchParams.error && (
        <div className="banner warn" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">Sync failed</div>
            <div className="b">{searchParams.error}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Creates the Stripe products, prices, and usage meter for each plan tier defined in{' '}
          <code>src/lib/billing-catalog.ts</code>. Safe to run more than once — plans that already
          exist locally are skipped.
        </p>
        <form action={sync}>
          <button className="btn primary" type="submit">Sync plans to Stripe</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Plan</th><th>Price</th><th>Seats</th><th>Avatars</th><th>Content/mo</th><th>Videos/day</th></tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</td>
                <td>{fmt(p.monthlyPriceCents)}/mo</td>
                <td className="muted">{p.seatLimit ?? 'Unlimited'}</td>
                <td className="muted">{p.avatarLimit ?? 'Unlimited'}</td>
                <td className="muted">{p.contentLimitMonthly ?? 'Unlimited'}</td>
                <td className="muted">{p.videoLimitDaily ?? 'Unlimited'}</td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>No plans yet — click "Sync plans to Stripe" above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
