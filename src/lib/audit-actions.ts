// Every `action` value the app writes to audit_log, in one place so the
// admin console (admin.audit.actions.*) and the content detail page
// (content.audit.actions.*) label the same set. Anything else (older rows,
// future actions) falls back to the raw value so a new action never crashes
// a page — add the label to BOTH namespaces when you add one here.

/** Content lifecycle actions — labelled in `content.audit.actions` and `admin.audit.actions`. */
export const CONTENT_AUDIT_ACTIONS = [
  'submit_for_review', 'approve', 'reject', 'revise', 'schedule', 'schedule_with_time', 'reschedule',
  'unschedule', 'publish', 'generate_video', 'confirm_video', 'confirm_disclosure',
  'generate_from_monitoring', 'cron_publish', 'cron_publish_failed', 'cron_publish_error',
  'cron_publish_not_connected',
] as const;

/** Join flow, channels and admin-console actions — labelled in `admin.audit.actions` only. */
export const SYSTEM_AUDIT_ACTIONS = [
  'user_joined',
  'channels_profile_created', 'channels_link_started', 'channels_disconnected',
  'channels_profile_orphaned', 'channels_setup_failed',
  'admin_impersonate', 'admin_user_added', 'admin_user_removed',
] as const;

export const KNOWN_AUDIT_ACTIONS = [...CONTENT_AUDIT_ACTIONS, ...SYSTEM_AUDIT_ACTIONS] as const;

export type ContentAuditAction = (typeof CONTENT_AUDIT_ACTIONS)[number];
export type KnownAuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number];

export function isContentAuditAction(action: string): action is ContentAuditAction {
  return (CONTENT_AUDIT_ACTIONS as readonly string[]).includes(action);
}

export function isKnownAuditAction(action: string): action is KnownAuditAction {
  return (KNOWN_AUDIT_ACTIONS as readonly string[]).includes(action);
}
