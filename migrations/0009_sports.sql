-- BanditBoard Live: universel regelmotor for alle sportsgrene.
-- Regelsæt gemmes i låste versioner. Turneringer og kampe får en fastlåst kopi af reglerne,
-- så senere ændringer aldrig ændrer allerede spillede kampe. Hændelser slettes aldrig – de annulleres.

create table if not exists sport_rulesets (
  id text primary key,
  owner_id text not null references "user" ("id") on delete cascade,
  sport_id text not null,
  level text not null default 'tournament',
  name text not null,
  variant text not null default '',
  status text not null default 'draft',
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sport_rulesets_owner_idx on sport_rulesets (owner_id, sport_id);

create table if not exists sport_ruleset_versions (
  id text primary key,
  ruleset_id text not null references sport_rulesets ("id") on delete cascade,
  version integer not null,
  rules text not null,
  custom_events text not null default '[]',
  note text not null default '',
  created_by text,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (ruleset_id, version)
);

create table if not exists sport_tournaments (
  id text primary key,
  owner_id text not null references "user" ("id") on delete cascade,
  name text not null,
  sport_id text not null,
  ruleset_version_id text,
  rule_label text not null default '',
  rules_snapshot text not null,
  custom_events text not null default '[]',
  format text not null default 'league',
  status text not null default 'running',
  participants text not null default '[]',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sport_tournaments_owner_idx on sport_tournaments (owner_id);

create table if not exists sport_matches (
  id text primary key,
  owner_id text not null references "user" ("id") on delete cascade,
  tournament_id text references sport_tournaments ("id") on delete cascade,
  sport_id text not null,
  rule_label text not null default '',
  rules_snapshot text not null,
  custom_events text not null default '[]',
  title text not null default '',
  round_label text not null default '',
  round_no integer not null default 0,
  group_label text not null default '',
  participants text not null default '[]',
  status text not null default 'scheduled',
  summary text not null default '{}',
  approved boolean not null default false,
  approved_by text not null default '',
  approved_at timestamptz,
  is_public boolean not null default true,
  view_key text not null,
  next_match_id text,
  next_slot integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists sport_matches_owner_idx on sport_matches (owner_id, updated_at desc);
create index if not exists sport_matches_tournament_idx on sport_matches (tournament_id);

create table if not exists sport_events (
  id text primary key,
  match_id text not null references sport_matches ("id") on delete cascade,
  seq integer not null,
  at bigint not null,
  type text not null,
  side text,
  player text,
  minute integer,
  data text not null default '{}',
  by_id text,
  by_name text not null default '',
  voided_at bigint,
  voided_by text not null default '',
  void_reason text not null default '',
  unique (match_id, seq)
);
create index if not exists sport_events_match_idx on sport_events (match_id, seq);

create table if not exists sport_result_history (
  id text primary key,
  match_id text not null references sport_matches ("id") on delete cascade,
  at timestamptz not null default now(),
  by_id text,
  by_name text not null default '',
  action text not null,
  before text not null default '',
  after text not null default '',
  reason text not null default ''
);
create index if not exists sport_result_history_match_idx on sport_result_history (match_id, at desc);
