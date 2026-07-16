import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side admin client — bypasses RLS, only used in server actions and server components.
export const adminDb = createClient(url, serviceKey);

// supabase-js reports write failures on the resolved `{ error }` field WITHOUT
// throwing. Every mutation must be routed through this so a failed write is
// surfaced loudly instead of silently desyncing lifecycle/audit/usage state
// (audit finding DATA-7). Query builders are thenables, so this awaits them
// directly. `context` names the call site for the thrown message.
export async function throwOnError<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
  context: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}
