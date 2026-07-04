export interface PlanDefinition {
  id: string;
  name: string;
  monthlyPriceCents: number;
  seatLimit: number | null;
  includedUsageCents: number;
  overageMultiplier: number;
}

// Exact values from docs/superpowers/specs/2026-07-03-stripe-billing-design.md
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  { id: 'starter',    name: 'Starter',    monthlyPriceCents: 4_900,  seatLimit: 3,    includedUsageCents: 2_500,  overageMultiplier: 1.3 },
  { id: 'pro',        name: 'Pro',        monthlyPriceCents: 14_900, seatLimit: 10,   includedUsageCents: 10_000, overageMultiplier: 1.3 },
  { id: 'enterprise', name: 'Enterprise', monthlyPriceCents: 49_900, seatLimit: null, includedUsageCents: 40_000, overageMultiplier: 1.2 },
];

// Every campaign's blended AI/video/voice usage reports to this one Stripe
// Billing Meter, in cents. Each plan's metered price applies its own
// included-allowance/overage tiers on top of the same underlying meter.
export const METER_EVENT_NAME = 'platform_usage_cents';
