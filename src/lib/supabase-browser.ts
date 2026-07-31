import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Browser-only client used to PUT files directly to Supabase Storage via a
// signed upload URL minted server-side (see beginAvatarUploadAction /
// beginVideoAvatarUploadAction in src/app/actions.ts). This keeps large
// photo/video bytes off our own serverless functions entirely, avoiding
// Vercel's function payload limit (413 FUNCTION_PAYLOAD_TOO_LARGE) that
// sending raw uploads through a Server Action body would otherwise hit. The
// publishable key only grants what the signed upload token itself
// authorizes, so it's safe to ship to the client.
export const supabaseBrowser = createClient(url, publishableKey);
