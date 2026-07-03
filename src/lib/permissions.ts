import type { Role } from '@/domain/types';

type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars';

const PERMISSIONS: Record<Action, Role[]> = {
  approve:        ['owner', 'manager', 'approver'],
  schedule:       ['owner', 'manager'],
  publish:        ['owner', 'manager'],
  edit_settings:  ['owner', 'manager'],
  manage_avatars: ['owner', 'manager'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
