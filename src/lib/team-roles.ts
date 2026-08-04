export const INVITABLE_ROLES = ['manager', 'staff', 'approver'] as const;

export type InvitableRole = typeof INVITABLE_ROLES[number];

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}
