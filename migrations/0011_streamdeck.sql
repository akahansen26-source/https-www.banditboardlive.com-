-- BanditBoard Live: Stream Deck / fjernbetjening af scoreboardet.
-- Hver bruger kan have én nøgle (kun hash gemmes). Knaptryk lægges i en kort kø,
-- som brugerens åbne scoreboard henter og udfører som almindelige klik.

create table if not exists board_remote (
  user_id text primary key references "user" ("id") on delete cascade,
  token_hash text unique,
  token_hint text not null default '',
  catalog text not null default '[]',
  status text not null default '{}',
  status_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists board_commands (
  id bigserial primary key,
  user_id text not null references "user" ("id") on delete cascade,
  act text not null,
  v text not null default '',
  source text not null default '',
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  done_at timestamptz,
  ok boolean,
  message text not null default ''
);
create index if not exists board_commands_pending_idx on board_commands (user_id, id);
