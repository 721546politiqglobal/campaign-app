import { describe, it, expect } from 'vitest';
import en from './en.json';
import es from './es.json';

function keys(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object') return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('message catalogs', () => {
  it('en and es have exactly the same keys', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });
  it('define the channels namespace and nav label', () => {
    expect(keys(en)).toContain('common.nav.channels');
    expect(keys(en)).toContain('channels.title');
  });
});
