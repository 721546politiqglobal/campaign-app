import { describe, it, expect, afterEach } from 'vitest';
import { monitoringBearerOk } from './monitoring-auth';

const OLD = process.env.MONITORING_INGEST_SECRET;
afterEach(() => { process.env.MONITORING_INGEST_SECRET = OLD; });

describe('monitoringBearerOk', () => {
  it('accepts the correct bearer token', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk('Bearer s3cret-value')).toBe(true);
  });

  it('rejects a wrong token', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk('Bearer nope')).toBe(false);
  });

  it('rejects when the header is missing', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk(null)).toBe(false);
  });

  it('fails closed when the secret env var is unset (no "Bearer undefined" bypass)', () => {
    delete process.env.MONITORING_INGEST_SECRET;
    expect(monitoringBearerOk('Bearer undefined')).toBe(false);
    expect(monitoringBearerOk('Bearer ')).toBe(false);
  });

  it('does not throw on a length-mismatched token', () => {
    process.env.MONITORING_INGEST_SECRET = 'short';
    expect(() => monitoringBearerOk('Bearer a-much-longer-token')).not.toThrow();
    expect(monitoringBearerOk('Bearer a-much-longer-token')).toBe(false);
  });
});
