import { describe, it, expect } from 'vitest';
import { isSupportedLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from './locale';

describe('isSupportedLocale', () => {
  it('accepts every entry in SUPPORTED_LOCALES', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true);
    }
  });

  it('rejects unsupported, empty, and nullish values', () => {
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('defaults to en', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});
