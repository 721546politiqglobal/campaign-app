export type SeedRole = 'owner' | 'manager' | 'approver' | 'staff' | 'admin' | 'ownerB' | 'staffEs';
export const PASSWORD = 'e2e-pass-123';
export const USERS: Record<SeedRole, { id: string; email: string; role: string; campaignId: string | null; name: string }> = {
  owner:    { id: 'e2e-owner-a',    email: 'owner-a@e2e.test',    role: 'owner',       campaignId: 'e2e-camp-a', name: 'Olivia Owner' },
  manager:  { id: 'e2e-manager-a',  email: 'manager-a@e2e.test',  role: 'manager',     campaignId: 'e2e-camp-a', name: 'Marco Manager' },
  approver: { id: 'e2e-approver-a', email: 'approver-a@e2e.test', role: 'approver',    campaignId: 'e2e-camp-a', name: 'Ava Approver' },
  staff:    { id: 'e2e-staff-a',    email: 'staff-a@e2e.test',    role: 'staff',       campaignId: 'e2e-camp-a', name: 'Sam Staff' },
  staffEs:  { id: 'e2e-staff-es-a', email: 'staff-es@e2e.test',   role: 'staff',       campaignId: 'e2e-camp-a', name: 'Sofía Staff' },
  ownerB:   { id: 'e2e-owner-b',    email: 'owner-b@e2e.test',    role: 'owner',       campaignId: 'e2e-camp-b', name: 'Ben Owner' },
  admin:    { id: 'e2e-admin',      email: 'admin-e2e@e2e.test',  role: 'super_admin', campaignId: null,         name: 'E2E Admin' },
};
// Users reserved for auth.spec (login throttle etc.) — never used for storageState.
export const AUTH_ONLY = {
  throttle: { id: 'e2e-throttle', email: 'throttle@e2e.test' },
  logout:   { id: 'e2e-logout',   email: 'logout@e2e.test' },
};
export const CAMPAIGN_A = 'e2e-camp-a';
export const CAMPAIGN_B = 'e2e-camp-b';
export const INVITES = { valid: 'E2E-VALID-1', used: 'E2E-USED-1', expired: 'E2E-EXPIRED-1', validB: 'E2E-VALID-2' };
// Seeded content in campaign A, one per lifecycle state, reserved per spec
export const CONTENT = {
  draft: 'e2e-c-draft', inReview: 'e2e-c-review', approved: 'e2e-c-approved',
  // NOTE: scheduledDue is already due, so any publish-cron call (cron-api.spec) publishes it.
  // It is consumed by the cron: never rely on its status still being 'scheduled'.
  scheduledDue: 'e2e-c-sched-due', scheduledFuture: 'e2e-c-sched-future',
  published: 'e2e-c-published', campaignB: 'e2e-c-b-1',
} as const;
