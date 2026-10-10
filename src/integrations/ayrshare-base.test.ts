import { describe, it, expect, vi, afterEach } from 'vitest';
import { ayrshareUrl } from './ayrshare-base';

afterEach(() => vi.unstubAllEnvs());

describe('ayrshareUrl', () => {
  it('unset → the real Ayrshare hosts, exactly', () => {
    vi.stubEnv('AYRSHARE_BASE_URL', '');
    expect(ayrshareUrl('app', '/post')).toBe('https://app.ayrshare.com/api/post');
    expect(ayrshareUrl('app', '/analytics/post')).toBe('https://app.ayrshare.com/api/analytics/post');
    expect(ayrshareUrl('api', '/profiles')).toBe('https://api.ayrshare.com/api/profiles');
  });

  it('set → <base>/<host>/api<path>, so a fake can tell the hosts apart', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AYRSHARE_BASE_URL', 'http://127.0.0.1:3199');
    expect(ayrshareUrl('app', '/post')).toBe('http://127.0.0.1:3199/app/api/post');
    expect(ayrshareUrl('api', '/user')).toBe('http://127.0.0.1:3199/api/api/user');
  });

  it('tolerates a trailing slash on the base', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AYRSHARE_BASE_URL', 'http://127.0.0.1:3199/');
    expect(ayrshareUrl('app', '/post')).toBe('http://127.0.0.1:3199/app/api/post');
  });

  it('is read at call time, not module load', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AYRSHARE_BASE_URL', 'http://localhost:1');
    expect(ayrshareUrl('api', '/user')).toBe('http://localhost:1/api/api/user');
    vi.stubEnv('AYRSHARE_BASE_URL', '');
    expect(ayrshareUrl('api', '/user')).toBe('https://api.ayrshare.com/api/user');
  });

  it('production + non-loopback override → throws (never send the real key to a foreign host)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const base of [
      'https://evil.example.com', 'http://10.0.0.5:3199', 'http://localhost.evil.com', 'not a url',
      'http://127.0.0.1@evil.com', // userinfo: the real host is evil.com
      'http://localhost.', // trailing dot is a different (DNS) name
      'file://localhost', 'ftp://127.0.0.1', // only http:/https:
    ]) {
      vi.stubEnv('AYRSHARE_BASE_URL', base);
      expect(() => ayrshareUrl('app', '/post'), base).toThrow('AYRSHARE_BASE_URL must be a loopback URL in production');
    }
  });

  it('production + loopback override → honoured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const base of ['http://localhost:3199', 'http://127.0.0.1:3199', 'http://[::1]:3199', 'http://LOCALHOST:3199', 'https://localhost:3199']) {
      vi.stubEnv('AYRSHARE_BASE_URL', base);
      expect(ayrshareUrl('app', '/post')).toBe(`${base}/app/api/post`);
    }
  });

  it('production + unset → real hosts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_BASE_URL', '');
    expect(ayrshareUrl('app', '/post')).toBe('https://app.ayrshare.com/api/post');
  });
});
