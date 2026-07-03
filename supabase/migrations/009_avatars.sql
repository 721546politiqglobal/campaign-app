-- supabase/migrations/009_avatars.sql
-- Campaigns create and manage their own HeyGen photo avatars in-app,
-- replacing admin-only manual avatar-group-ID assignment.

create table if not exists avatars (
  id                    text primary key,
  campaign_id           text not null references campaigns(id) on delete cascade,
  name                  text not null,
  status                text not null default 'training'
                          check (status in ('training', 'ready', 'failed')),
  heygen_group_id       text,
  source_photo_urls     text[] not null default '{}',
  error_message         text,
  consent_confirmed_by  text not null references users(id),
  consent_confirmed_at  timestamptz not null default now(),
  created_by            text not null references users(id),
  created_at            timestamptz not null default now()
);

create index if not exists idx_avatars_campaign on avatars(campaign_id);

-- No `on delete cascade`/`set null` here on purpose: this FK doubles as a
-- database-level guard against deleting the currently active avatar,
-- backing up the same check in deleteAvatarAction.
alter table candidate_profiles
  add column if not exists active_avatar_id text references avatars(id);

-- Unused: AvatarLibrary.tsx always hardcoded this to null.
alter table candidate_profiles
  drop column if exists heygen_look_id;
