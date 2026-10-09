import { getFormatter } from 'next-intl/server';

// One locale-aware formatter for every admin page (replaces the copy-pasted
// `fmt()` helpers that hardcoded 'en-US').
export async function adminFormat() {
  const f = await getFormatter();
  return {
    date: (iso: string) => f.dateTime(new Date(iso), { dateStyle: 'medium' }),
    dateTime: (iso: string) => f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }),
    currency: (cents: number) => f.number(cents / 100, { style: 'currency', currency: 'USD' }),
    integer: (n: number) => f.number(n),
  };
}

export type AdminFormat = Awaited<ReturnType<typeof adminFormat>>;
