import { describe, it, expect } from 'vitest';
import { isAuthorizedCron } from './cron-auth';

describe('isAuthorizedCron', () => {
  it('accepts the exact bearer token', () => {
    expect(isAuthorizedCron('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('rejects a wrong token, a prefix, and a longer token', () => {
    expect(isAuthorizedCron('Bearer s3cre', 's3cret')).toBe(false);
    expect(isAuthorizedCron('Bearer s3cret!', 's3cret')).toBe(false);
    expect(isAuthorizedCron('Bearer nope!!', 's3cret')).toBe(false);
  });

  it('fails closed when the secret is unset or the header is missing', () => {
    expect(isAuthorizedCron('Bearer undefined', undefined)).toBe(false);
    expect(isAuthorizedCron('Bearer ', '')).toBe(false);
    expect(isAuthorizedCron(null, 's3cret')).toBe(false);
  });
});
