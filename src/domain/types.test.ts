import { describe, it, expect } from 'vitest';
import { CONTENT_TYPES, isContentType } from './types';

describe('content type guard', () => {
  it('lists exactly the five known types', () => {
    expect([...CONTENT_TYPES].sort()).toEqual(
      ['ad_copy', 'press_release', 'reel', 'social_post', 'talking_points'].sort(),
    );
  });
  it('accepts a known type', () => {
    expect(isContentType('social_post')).toBe(true);
  });
  it('rejects an unknown type', () => {
    expect(isContentType('malicious_kind')).toBe(false);
    expect(isContentType('')).toBe(false);
  });
});
