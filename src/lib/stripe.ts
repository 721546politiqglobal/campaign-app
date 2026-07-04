import Stripe from 'stripe';

// Activates automatically when STRIPE_SECRET_KEY is present, matching the
// pattern in src/lib/services.ts for the other external integrations.
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
