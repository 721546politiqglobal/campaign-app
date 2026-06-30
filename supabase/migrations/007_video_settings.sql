-- supabase/migrations/007_video_settings.sql
-- Add per-campaign video settings to candidate_profiles
alter table candidate_profiles
  add column if not exists heygen_avatar_id    text,
  add column if not exists heygen_look_id      text,
  add column if not exists elevenlabs_voice_id text,
  add column if not exists video_aspect_ratio  text not null default '16:9'
    check (video_aspect_ratio in ('16:9', '9:16', '1:1')),
  add column if not exists video_background    text not null default 'plain';
