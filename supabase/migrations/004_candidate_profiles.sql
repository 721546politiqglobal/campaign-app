-- supabase/migrations/004_candidate_profiles.sql
create table if not exists candidate_profiles (
  id                text primary key,
  campaign_id       text not null references campaigns(id) on delete cascade,
  full_name         text not null,
  preferred_name    text not null,
  office            text not null,
  district          text not null,
  party             text not null default '',
  bio               text not null default '',
  key_positions     text[] not null default '{}',
  voice_tone        text not null default 'conversational'
                      check (voice_tone in ('formal','conversational','urgent','inspirational')),
  target_audience   text not null default '',
  tagline           text not null default '',
  photo_url         text,
  opponent_name     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id)
);
