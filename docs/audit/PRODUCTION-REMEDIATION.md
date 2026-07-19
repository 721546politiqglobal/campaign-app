# Production Remediation — seeded credentials (DATA-4 / SEC-9)

**Why this exists:** earlier migrations set a known password (`changeme123`) on a
super-admin and three demo accounts. Editing the migration files stops *future*
databases from being seeded that way, but any database the old migrations
already ran against still has those known-credential accounts. This is a
**critical** exposure: anyone who has seen this repo can log in as
`admin@commandcenter.local` / `changeme123` and control every campaign.

Run the steps below against each already-deployed database. **Do this yourself**
— it changes live credentials and must not be automated from application code.

## 1. Disable the seeded credentials immediately

```sql
UPDATE users
SET password_hash = NULL
WHERE email IN (
  'admin@commandcenter.local',
  'alex@example.com',
  'sarah@example.com',
  'mike@example.com'
);
```

Nulling `password_hash` makes these accounts un-loginable (loginAction requires a
hash) without deleting audit history tied to them.

## 2. Create a real super-admin

Pick a strong password (or better, a random one you store in a password
manager), then:

```sql
-- Replace the email and password with real values.
INSERT INTO users (id, campaign_id, name, role)
VALUES (gen_random_uuid()::text, NULL, 'Your Name', 'super_admin')
ON CONFLICT DO NOTHING;

UPDATE users
SET email = '<your-real-admin-email>',
    password_hash = crypt('<STRONG_GENERATED_PASSWORD>', gen_salt('bf', 10))
WHERE role = 'super_admin' AND email IS NULL;
```

(`crypt`/`gen_salt` require the `pgcrypto` extension, already enabled by
migration 003.)

## 3. Decide what to do with the demo campaigns

If `camp-1` (Rivera) and `camp-2` (Johnson) and their content/usage exist in
production, they are demo data and inflate stats. Remove them once you have your
real super-admin, if they aren't real customers:

```sql
-- CAUTION: cascades to that campaign's users, content, approvals, usage, etc.
DELETE FROM campaigns WHERE id IN ('camp-1', 'camp-2');
```

## 4. Verify no account still uses the default password

Should return **0 rows** after step 1:

```sql
SELECT id, email FROM users
WHERE password_hash IS NOT NULL
  AND password_hash = crypt('changeme123', password_hash);
```

## 5. Confirm login

- The four seeded emails can no longer sign in.
- Your new super-admin email + its password reaches `/admin`.

---

Going forward, fresh databases get **no** seeded credentials (migrations are
schema + reference config only). Local/dev environments load demo data and the
`changeme123` logins from `supabase/seed.dev.sql`, which must never be run
against production.

## Monitoring ingest secret (SEC-5)

The n8n "Campaign App Service Auth" HTTP Header Auth credential previously sent
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Update it to send
`Authorization: Bearer <MONITORING_INGEST_SECRET>` using the value now set in the
app's `MONITORING_INGEST_SECRET` env var. Rotate the Supabase service-role key
afterward, since it was shared off-box.
