import { isKnownAuditAction } from '@/lib/audit-actions';

export { KNOWN_AUDIT_ACTIONS, isKnownAuditAction, type KnownAuditAction } from '@/lib/audit-actions';

/** Translated label for an audit `action` (admin.audit.actions.*), or the raw value for anything unknown. */
export function auditActionLabel(t: (key: string) => string, action: string): string {
  return isKnownAuditAction(action) ? t(`actions.${action}`) : action;
}
