import { describe, it, expect } from 'vitest';
import { buildHref, parseDir, parseEnum, parsePage, parseQ } from './query';

describe('admin query helpers', () => {
  it('parses page numbers defensively', () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage('7')).toBe(7);
  });

  it('validates enums, directions and trims/limits search text', () => {
    expect(parseEnum('name', ['name', 'created'] as const, 'created')).toBe('name');
    expect(parseEnum('drop table', ['name', 'created'] as const, 'created')).toBe('created');
    expect(parseDir('asc')).toBe('asc');
    expect(parseDir('sideways')).toBeUndefined();
    expect(parseQ('  hi  ')).toBe('hi');
    expect(parseQ('x'.repeat(500))).toHaveLength(100);
  });

  it('builds hrefs that drop empty values and page=1', () => {
    expect(buildHref('/admin/users', { q: '', page: 1, sort: undefined })).toBe('/admin/users');
    expect(buildHref('/admin/users', { q: 'a b', page: 2, sort: 'name', dir: 'desc' })).toBe('/admin/users?q=a+b&page=2&sort=name&dir=desc');
  });
});
