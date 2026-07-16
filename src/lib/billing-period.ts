// Single source of truth for the "current spend period" used by the cap guard
// and every spend display. Anchored on the Stripe billing period end so the
// cap window, the dashboard, and the billing page all agree (resolves UX-1).
export function billingPeriodStart(currentPeriodEnd: string | null, now: Date = new Date()): Date {
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return start;
  }
  // No subscription yet: UTC calendar month, matching reserve_usage's fallback.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
