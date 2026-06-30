import type { Role } from '@/domain/types';

type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings';

const PERMISSIONS: Record<Action, Role[]> = {
  approve:       ['owner', 'manager', 'approver'],
  schedule:      ['owner', 'manager'],
  publish:       ['owner', 'manager'],
  edit_settings: ['owner', 'manager'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
