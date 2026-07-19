import { describe, it, expect } from 'vitest';
import { throwOnError } from './supabase';

describe('throwOnError', () => {
  it('returns data when there is no error', async () => {
    const q = Promise.resolve({ data: [{ id: 'a' }], error: null });
    await expect(throwOnError(q, 'ctx')).resolves.toEqual([{ id: 'a' }]);
  });

  it('throws with the context prefix when Supabase reports an error', async () => {
    const q = Promise.resolve({ data: null, error: { message: 'duplicate key value' } });
    await expect(throwOnError(q, 'content_items.setStatus'))
      .rejects.toThrow('content_items.setStatus: duplicate key value');
  });
});
