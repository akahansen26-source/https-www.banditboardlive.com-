create table if not exists public_tournament (
  id integer primary key,
  name text not null default 'Klubaften',
  plan text not null default '',
  updated_at timestamptz not null default now()
);

insert into public_tournament (id, name, plan)
values (1, 'Klubaften', '')
on conflict (id) do nothing;

create table if not exists tournament_players (
  user_id text primary key references "user" ("id") on delete cascade,
  name text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists ranking_rows (
  id text primary key,
  name text not null,
  points integer not null default 0,
  wins integer not null default 0,
  sort integer not null default 0
);

create table if not exists match_history (
  id text primary key,
  played_at timestamptz not null default now(),
  title text not null,
  detail text not null default ''
);
