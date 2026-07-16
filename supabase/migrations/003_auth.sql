-- Auth migration: real email/password + invite codes
-- Run in Supabase SQL editor after 001_init.sql and 002_super_admin.sql

-- pgcrypto for bcrypt hashing of seed passwords
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Add auth columns to users ────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Unique sparse index: enforces uniqueness only for rows that have an email
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email) WHERE email IS NOT NULL;

-- ── Invite codes ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invite_codes (
  code        text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'staff'
                CHECK (role IN ('owner','manager','staff','approver')),
  created_by  text NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_by     text,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_campaign ON invite_codes(campaign_id);

-- NOTE: Default seed-account credentials are intentionally NOT set here.
-- Assigning a known password (e.g. 'changeme123') in a numbered migration
-- creates a known-credential account on every database the migration runs
-- against, including production. Dev credentials now live in
-- supabase/seed.dev.sql; the first production super-admin is bootstrapped
-- explicitly per docs/audit/PRODUCTION-REMEDIATION.md.
