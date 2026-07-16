import { describe, it, expect } from 'vitest';
import { uid, prefixedId, inviteCode } from './store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('id helpers', () => {
  it('uid returns a v4 UUID', () => {
    expect(uid()).toMatch(UUID);
  });

  it('uid is collision-resistant across many draws', () => {
    const set = new Set(Array.from({ length: 10_000 }, () => uid()));
    expect(set.size).toBe(10_000);
  });

  it('prefixedId keeps the prefix and appends a UUID', () => {
    const id = prefixedId('camp-');
    expect(id.startsWith('camp-')).toBe(true);
    expect(id.slice('camp-'.length)).toMatch(UUID);
  });

  it('inviteCode is high-entropy and URL-safe', () => {
    const c = inviteCode();
    expect(c.startsWith('inv_')).toBe(true);
    expect(c.length).toBeGreaterThan(20);
    expect(c.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
    const many = new Set(Array.from({ length: 10_000 }, () => inviteCode()));
    expect(many.size).toBe(10_000);
  });
});
