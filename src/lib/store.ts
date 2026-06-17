// Thin helpers used by actions and pages.
// All data now lives in Supabase — see src/lib/data.ts and src/lib/repos.ts.

export const uid = () => Math.random().toString(36).slice(2, 10);
