import { describe, it, expect } from 'vitest';
import { can } from './permissions';

describe('can – approve', () => {
  it('allows owner',    () => expect(can('owner',    'approve')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'approve')).toBe(true));
  it('allows approver', () => expect(can('approver', 'approve')).toBe(true));
  it('denies staff',    () => expect(can('staff',    'approve')).toBe(false));
});

describe('can – schedule', () => {
  it('allows owner',    () => expect(can('owner',    'schedule')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'schedule')).toBe(true));
  it('denies approver', () => expect(can('approver', 'schedule')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'schedule')).toBe(false));
});

describe('can – publish', () => {
  it('allows owner',    () => expect(can('owner',    'publish')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'publish')).toBe(true));
  it('denies approver', () => expect(can('approver', 'publish')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'publish')).toBe(false));
});

describe('can – edit_settings', () => {
  it('allows owner',    () => expect(can('owner',    'edit_settings')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'edit_settings')).toBe(true));
  it('denies approver', () => expect(can('approver', 'edit_settings')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'edit_settings')).toBe(false));
});

describe('can – manage_avatars', () => {
  it('allows owner',    () => expect(can('owner',    'manage_avatars')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'manage_avatars')).toBe(true));
  it('denies approver', () => expect(can('approver', 'manage_avatars')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'manage_avatars')).toBe(false));
});
