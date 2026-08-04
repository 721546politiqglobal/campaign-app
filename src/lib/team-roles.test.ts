import { describe, it, expect } from 'vitest';
import { INVITABLE_ROLES, isInvitableRole } from './team-roles';

describe('INVITABLE_ROLES', () => {
  it('is exactly manager, staff, approver — never owner or super_admin', () => {
    expect(INVITABLE_ROLES).toEqual(['manager', 'staff', 'approver']);
  });
});

describe('isInvitableRole', () => {
  it('accepts manager, staff, approver', () => {
    expect(isInvitableRole('manager')).toBe(true);
    expect(isInvitableRole('staff')).toBe(true);
    expect(isInvitableRole('approver')).toBe(true);
  });

  it('rejects owner, super_admin, and garbage input', () => {
    expect(isInvitableRole('owner')).toBe(false);
    expect(isInvitableRole('super_admin')).toBe(false);
    expect(isInvitableRole('')).toBe(false);
    expect(isInvitableRole('OWNER')).toBe(false);
  });
});
