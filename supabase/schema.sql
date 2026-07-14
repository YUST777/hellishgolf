-- Peak Putt Supabase schema.
-- Run this in the Supabase SQL Editor if you want to create the tables manually.
-- The Devvit server also runs this shape automatically when DB env is configured.

create table if not exists leaderboard (
  date_key text not null,
  post_id text not null,
  username text not null,
  map_id integer not null,
  strokes integer not null check (strokes > 0),
  time_ms integer not null check (time_ms >= 0),
  streak integer not null default 0,
  replay_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date_key, post_id, username)
);

create index if not exists leaderboard_order_idx
  on leaderboard (date_key, post_id, strokes, time_ms, updated_at, username);

create table if not exists usermoves (
  id text primary key,
  date_key text not null,
  post_id text not null,
  username text not null,
  map_id integer not null,
  strokes integer not null check (strokes > 0),
  time_ms integer not null check (time_ms >= 0),
  moves jsonb not null check (jsonb_typeof(moves) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists usermoves_player_idx
  on usermoves (date_key, post_id, username, created_at desc);

create index if not exists usermoves_post_idx
  on usermoves (post_id, created_at desc);

alter table leaderboard
  add column if not exists replay_id text;
