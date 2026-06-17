# Campaign command center — Next.js app

A complete, running campaign communications app: frontend + backend, with the
approval and AI-disclosure gates wired through the whole flow. It runs locally
out of the box with seeded demo data — no accounts or API keys needed.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

Build for production: `npm run build && npm start`.

## What you can do (demo walkthrough)

1. **Sign in** as one of three demo users. Role changes what you can do — this is
   the point of the gates.
2. **Dashboard** shows the review queue, a compliance banner (disclosure rules
   still need legal review), monitoring highlights, and month-to-date spend vs cap.
3. **New content → Generate draft with AI** writes a draft (mock generator) and
   marks it AI-generated. Save it.
4. **Submit for review** (as staff). Now sign out and sign back in as the
   **Approver** or **Manager** to approve it — staff cannot approve, by design.
5. Once approved, **attach the required disclosure** (pulled from the campaign's
   jurisdictions) and **schedule**. Try to schedule before doing both — it's
   blocked, and the gate strip shows why.
6. **Publish** to selected platforms. The disclosure travels with the post.

Every action is written to an append-only activity log on the content page.

## How it's built

- **Frontend** — Next.js App Router (`src/app`), server components for reads,
  server actions for mutations (`src/app/actions.ts`), a handful of client
  components for interactive bits. Plain CSS design system in `globals.css`.
- **Backend / brain** — `src/domain` holds the vendor-free logic: the content
  lifecycle state machine + gates, the disclosure engine, and the spend meter.
- **Data** — `src/lib/store.ts` is an in-memory store (resets on restart),
  bound to the domain through `src/lib/repos.ts`. Swap in Supabase by
  reimplementing those repos against the SQL schema from the spine package.
- **External services** — `src/integrations` defines interfaces; demo mode uses
  mock implementations. `src/lib/services.ts` is where real adapters drop in.

## Going live (what each step needs)

1. **Persistent data + auth** — create a Supabase project, run the spine's SQL
   migration, and reimplement `src/lib/repos.ts` and `src/lib/session.ts` against
   it. The interfaces stay the same.
2. **AI drafting** — replace `MockContentGenerator` with a real model call; keep
   it grounded with cited sources so opponent rebuttals don't invent claims.
3. **Video / voice** — implement the HeyGen + ElevenLabs adapters. Requires a
   signed consent record for the candidate and confirmation their use policy
   permits political use on your plan.
4. **Publishing** — implement the Ayrshare adapter; validate per-platform
   political-content access and posting quotas first.
5. **Monitoring** — point n8n at GDELT/NewsData/Brand24 and write into the store.
6. **Billing** — add Stripe subscriptions tied to the usage meter.

## Important

The disclosure rules in the seed are **placeholders** flagged "needs legal
review." Confirm exact required wording and pre-election timing for each
jurisdiction with counsel before publishing AI content. Rules in this area
change often — verify against current sources.
