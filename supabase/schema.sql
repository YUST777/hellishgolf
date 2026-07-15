-- Hellish Golf Supabase schema.
-- Run this in the Supabase SQL Editor if you want to create the tables manually.
-- The Devvit server also runs this shape automatically when DB env is configured.
-- Writes use a server-only Postgres connection; browser roles receive no write access.

create table if not exists players (
  account_id text primary key,
  username text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists leaderboard (
  date_key text not null,
  post_id text not null,
  account_id text not null,
  username text not null,
  map_id integer not null,
  strokes integer not null check (strokes > 0),
  time_ms integer not null check (time_ms >= 0),
  streak integer not null default 0,
  replay_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date_key, post_id, account_id)
);

create index if not exists leaderboard_order_idx
  on leaderboard (date_key, post_id, strokes, time_ms, updated_at, username);

create table if not exists usermoves (
  id text primary key,
  date_key text not null,
  post_id text not null,
  account_id text not null,
  username text not null,
  map_id integer not null,
  strokes integer not null check (strokes > 0),
  time_ms integer not null check (time_ms >= 0),
  moves jsonb not null check (jsonb_typeof(moves) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists usermoves_player_idx
  on usermoves (date_key, post_id, account_id, created_at desc);

create index if not exists usermoves_post_idx
  on usermoves (post_id, created_at desc);

alter table leaderboard
  add column if not exists replay_id text;

alter table leaderboard add column if not exists account_id text;
alter table usermoves add column if not exists account_id text;
update leaderboard
  set account_id = 'legacy:' || lower(username)
  where account_id is null;
update usermoves
  set account_id = 'legacy:' || lower(username)
  where account_id is null;
alter table leaderboard alter column account_id set not null;
alter table usermoves alter column account_id set not null;

do $$
declare current_key text;
begin
  select string_agg(a.attname, ',' order by u.ordinality)
    into current_key
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as u(attnum, ordinality)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
  where c.conrelid = 'leaderboard'::regclass and c.contype = 'p';

  if current_key is distinct from 'date_key,post_id,account_id' then
    alter table leaderboard drop constraint if exists leaderboard_pkey;
    alter table leaderboard
      add constraint leaderboard_pkey primary key (date_key, post_id, account_id);
  end if;
end
$$;

drop index if exists usermoves_player_idx;
create index usermoves_player_idx
  on usermoves (date_key, post_id, account_id, created_at desc);

alter table players enable row level security;
alter table leaderboard enable row level security;
alter table usermoves enable row level security;

revoke all on table players, leaderboard, usermoves from public, anon, authenticated;

-- Security-advisor cleanup for unrelated legacy objects in this project.
do $$
begin
  if to_regclass('public.readings') is not null then
    execute 'drop policy if exists "anon insert readings" on public.readings';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
