-- Run this once in your Supabase SQL editor to set up the full schema + seed data.

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists campaigns (
  id                      text primary key,
  name                    text not null,
  jurisdictions           text[] not null default '{}',
  monthly_cost_cap_cents  integer not null default 100000,
  created_at              timestamptz not null default now()
);

create table if not exists users (
  id          text primary key,
  campaign_id text references campaigns(id) on delete cascade,
  name        text not null,
  role        text not null constraint users_role_check check (role in ('owner','manager','staff','approver','super_admin')),
  created_at  timestamptz not null default now()
);

create table if not exists content_items (
  id                    text primary key,
  campaign_id           text not null references campaigns(id) on delete cascade,
  type                  text not null,
  title                 text not null,
  body                  text not null default '',
  status                text not null default 'draft'
                          check (status in ('draft','in_review','approved','scheduled','published','rejected','archived')),
  is_ai_generated       boolean not null default false,
  target_jurisdictions  text[] not null default '{}',
  media_url             text,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists approval_records (
  id               text primary key default gen_random_uuid()::text,
  content_item_id  text not null references content_items(id) on delete cascade,
  campaign_id      text not null references campaigns(id) on delete cascade,
  approver_user_id text not null,
  decision         text not null check (decision in ('approve','reject')),
  note             text,
  created_at       timestamptz not null default now()
);

create table if not exists disclosure_records (
  id               text primary key default gen_random_uuid()::text,
  content_item_id  text not null references content_items(id) on delete cascade,
  campaign_id      text not null references campaigns(id) on delete cascade,
  jurisdiction     text not null,
  disclosure_text  text not null,
  placement        text not null,
  applied_at       timestamptz not null default now()
);

-- Append-only audit log — no update/delete allowed via application code.
create table if not exists audit_entries (
  id            text primary key default gen_random_uuid()::text,
  campaign_id   text not null references campaigns(id) on delete cascade,
  actor_user_id text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists disclosure_rules (
  jurisdiction                  text primary key,
  requires_ai_label             boolean not null default false,
  required_text                 text,
  placement                     text not null default 'overlay',
  blackout_days_before_election integer,
  needs_legal_review            boolean not null default false
);

create table if not exists monitoring_results (
  id          text primary key default gen_random_uuid()::text,
  campaign_id text not null references campaigns(id) on delete cascade,
  source      text not null,
  opponent    text,
  excerpt     text not null,
  url         text not null,
  captured_at timestamptz not null default now()
);

create table if not exists usage_events (
  id          text primary key default gen_random_uuid()::text,
  campaign_id text not null references campaigns(id) on delete cascade,
  kind        text not null,
  cost_cents  integer not null,
  created_at  timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists idx_content_campaign   on content_items(campaign_id);
create index if not exists idx_approvals_content  on approval_records(content_item_id);
create index if not exists idx_disclosures_content on disclosure_records(content_item_id);
create index if not exists idx_audit_entity       on audit_entries(entity_id);
create index if not exists idx_monitoring_campaign on monitoring_results(campaign_id);
create index if not exists idx_usage_campaign     on usage_events(campaign_id);

-- ── Reference config (required by the app, not tenant data) ──────────────────
-- The disclosure engine reads these rules. Wording/timing are PLACEHOLDERS
-- flagged needs_legal_review — confirm with counsel before relying on them.

insert into disclosure_rules (jurisdiction, requires_ai_label, required_text, placement, blackout_days_before_election, needs_legal_review)
values
  ('US-FEDERAL', true, null, 'overlay', null, true),
  ('US-CA', true, 'This content was generated or substantially altered using artificial intelligence.',
   'overlay', 60, true)
on conflict (jurisdiction) do nothing;

-- NOTE: Demo tenant data (campaigns, users, content, approvals, monitoring,
-- usage) and default login credentials are NOT seeded here — that would create
-- known-credential accounts and fake stats in production. They live in
-- supabase/seed.dev.sql for local/dev use only. Bootstrap the first production
-- super-admin explicitly (see docs/audit/PRODUCTION-REMEDIATION.md).
