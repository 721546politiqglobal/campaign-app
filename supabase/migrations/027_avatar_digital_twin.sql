-- supabase/migrations/027_avatar_digital_twin.sql
-- Adds support for HeyGen Digital Twin (video-trained) avatars alongside
-- the existing photo-avatar flow. See
-- docs/superpowers/specs/2026-07-21-video-avatar-creation-design.md.

alter table avatars
  add column if not exists source_type text not null default 'photo' check (source_type in ('photo', 'digital_twin')),
  add column if not exists source_video_url text,
  add column if not exists consent_status text check (consent_status in ('pending', 'approved', 'declined')),
  add column if not exists consent_url text;

alter table avatars drop constraint if exists avatars_status_check;
alter table avatars add constraint avatars_status_check
  check (status in ('pending_consent', 'training', 'ready', 'failed'));
