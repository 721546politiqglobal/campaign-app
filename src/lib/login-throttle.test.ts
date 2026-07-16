import { describe, it, expect } from 'vitest';
import { isLockedOut, nextFailureState, MAX_ATTEMPTS, WINDOW_MS, LOCKOUT_MS } from './login-throttle';

const T = 1_000_000_000_000; // fixed "now"

describe('login throttle decision', () => {
  it('is not locked with no prior attempts', () => {
    expect(isLockedOut(null, T)).toBe(false);
  });

  it('counts failures within the window', () => {
    let row = nextFailureState(null, T);
    expect(row).toEqual({ attempts: 1, windowStart: T, lockedUntil: null });
    row = nextFailureState(row, T + 1000);
    expect(row.attempts).toBe(2);
    expect(row.lockedUntil).toBeNull();
  });

  it('locks out at the threshold', () => {
    let row: any = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) row = nextFailureState(row, T + i * 1000);
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.lockedUntil).toBe(T + (MAX_ATTEMPTS - 1) * 1000 + LOCKOUT_MS);
    expect(isLockedOut(row, T + (MAX_ATTEMPTS - 1) * 1000 + 5000)).toBe(true);
  });

  it('reports unlocked once the lockout expires', () => {
    const row = { attempts: MAX_ATTEMPTS, windowStart: T, lockedUntil: T + LOCKOUT_MS };
    expect(isLockedOut(row, T + LOCKOUT_MS + 1)).toBe(false);
  });

  it('resets the counter when a new attempt arrives after the window closes', () => {
    const stale = { attempts: 3, windowStart: T, lockedUntil: null };
    const row = nextFailureState(stale, T + WINDOW_MS + 1);
    expect(row).toEqual({ attempts: 1, windowStart: T + WINDOW_MS + 1, lockedUntil: null });
  });
});
