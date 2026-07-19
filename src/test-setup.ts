// Vitest global setup. Provides dummy env for modules that construct clients at
// import time (e.g. src/lib/supabase.ts calls createClient at module load).
// These are placeholders — tests mock adminDb/stripe; no real network happens.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
