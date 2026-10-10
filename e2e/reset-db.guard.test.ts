import { describe, it, expect } from 'vitest';
import { assertAllowedTarget } from './reset-db';

const OK_DB = 'postgresql://postgres.pckrdspetqcdbmcrqapx:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';
const OK_API = 'https://pckrdspetqcdbmcrqapx.supabase.co';

describe('assertAllowedTarget', () => {
  it('accepts the e2e project via pooler username', () => {
    expect(assertAllowedTarget(OK_DB, OK_API)).toBe('pckrdspetqcdbmcrqapx');
  });
  it('accepts the e2e project via direct host', () => {
    expect(assertAllowedTarget('postgresql://postgres:pw@db.pckrdspetqcdbmcrqapx.supabase.co:5432/postgres', OK_API))
      .toBe('pckrdspetqcdbmcrqapx');
  });
  it('refuses the production project', () => {
    expect(() => assertAllowedTarget(
      'postgresql://postgres.dltahrjljptsmvksgqjl:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
      'https://dltahrjljptsmvksgqjl.supabase.co')).toThrow(/refusing/i);
  });
  it('refuses when DB and API point at different projects', () => {
    expect(() => assertAllowedTarget(OK_DB, 'https://dltahrjljptsmvksgqjl.supabase.co')).toThrow(/refusing/i);
  });
  it('refuses an empty url', () => {
    expect(() => assertAllowedTarget('', OK_API)).toThrow(/refusing/i);
  });

  it('refuses a ?host= query param that would redirect the connection', () => {
    expect(() => assertAllowedTarget(`${OK_DB}?host=db.dltahrjljptsmvksgqjl.supabase.co&user=postgres`, OK_API))
      .toThrow(/refusing/i);
  });
  it('refuses a ?user= query param override', () => {
    expect(() => assertAllowedTarget(
      'postgresql://postgres.pckrdspetqcdbmcrqapx:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?user=postgres.dltahrjljptsmvksgqjl',
      OK_API)).toThrow(/refusing/i);
  });
  it('refuses an allowed pooler username on another project\'s direct host', () => {
    expect(() => assertAllowedTarget(
      'postgresql://postgres.pckrdspetqcdbmcrqapx:pw@db.dltahrjljptsmvksgqjl.supabase.co:5432/postgres', OK_API))
      .toThrow(/refusing/i);
  });
  it('refuses an allowed username on a non-Supabase host', () => {
    expect(() => assertAllowedTarget(
      'postgresql://postgres.pckrdspetqcdbmcrqapx:pw@evil.example.com:5432/postgres', OK_API)).toThrow(/refusing/i);
  });
  it('refuses the pooler without a project-scoped username', () => {
    expect(() => assertAllowedTarget(
      'postgresql://postgres:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres', OK_API)).toThrow(/refusing/i);
  });
  it('allows sslmode as the only query param', () => {
    expect(assertAllowedTarget(`${OK_DB}?sslmode=require`, OK_API)).toBe('pckrdspetqcdbmcrqapx');
  });
  it('refuses an API URL that only starts with the allowed ref', () => {
    expect(() => assertAllowedTarget(OK_DB, 'https://pckrdspetqcdbmcrqapx.anything.example')).toThrow(/refusing/i);
  });
  it('refuses a non-https API URL', () => {
    expect(() => assertAllowedTarget(OK_DB, 'http://pckrdspetqcdbmcrqapx.supabase.co')).toThrow(/refusing/i);
  });
  it('refuses an empty or malformed API URL with a clear error', () => {
    expect(() => assertAllowedTarget(OK_DB, '')).toThrow(/refusing/i);
    expect(() => assertAllowedTarget(OK_DB, 'not a url')).toThrow(/refusing/i);
  });
});
