export interface PlanDefinition {
  id: string;
  name: string;
  monthlyPriceCents: number;
  seatLimit: number | null;
  avatarLimit: number | null;
  contentLimitMonthly: number | null;
  videoLimitDaily: number | null;
}

// Exact values from docs/superpowers/specs/2026-07-27-self-serve-billing-design.md
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  { id: 'starter',    name: 'Starter',    monthlyPriceCents: 4_900,  seatLimit: 3,    avatarLimit: 2,  contentLimitMonthly: 15,   videoLimitDaily: 1 },
  { id: 'pro',        name: 'Pro',        monthlyPriceCents: 14_900, seatLimit: 10,   avatarLimit: 5,  contentLimitMonthly: 50,   videoLimitDaily: 3 },
  { id: 'enterprise', name: 'Enterprise', monthlyPriceCents: 49_900, seatLimit: null, avatarLimit: 20, contentLimitMonthly: null, videoLimitDaily: 10 },
];
