import { describe, it, expect } from 'vitest';
import {
  CONTENT_AUDIT_ACTIONS, SYSTEM_AUDIT_ACTIONS, KNOWN_AUDIT_ACTIONS,
  isContentAuditAction, isKnownAuditAction,
} from './audit-actions';

describe('audit actions', () => {
  it('known = content + system with no duplicates', () => {
    expect(KNOWN_AUDIT_ACTIONS.length).toBe(CONTENT_AUDIT_ACTIONS.length + SYSTEM_AUDIT_ACTIONS.length);
    expect(new Set(KNOWN_AUDIT_ACTIONS).size).toBe(KNOWN_AUDIT_ACTIONS.length);
  });

  it('includes the previously unlabelled actions', () => {
    for (const a of ['revise', 'reschedule', 'unschedule', 'confirm_disclosure']) {
      expect(isContentAuditAction(a)).toBe(true);
    }
  });

  it('separates content from system actions', () => {
    expect(isContentAuditAction('user_joined')).toBe(false);
    expect(isKnownAuditAction('user_joined')).toBe(true);
  });

  it('rejects unknown actions', () => {
    expect(isKnownAuditAction('nope')).toBe(false);
    expect(isContentAuditAction('')).toBe(false);
  });
});
