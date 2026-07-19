-- supabase/migrations/024_heygen_voice_id.sql
-- HeyGen and ElevenLabs use different voice-id namespaces. Storing only the
-- ElevenLabs id and passing it to HeyGen's voice.voice_id made every keyed
-- video 400 ("voice not found"). Track a dedicated HeyGen voice id (INT-7).
alter table candidate_profiles
  add column if not exists heygen_voice_id text;
