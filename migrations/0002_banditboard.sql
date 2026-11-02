-- BanditBoard: klub-/pub-profiler, scoreboard-tilstand og sidens kontaktoplysninger.

create table if not exists profiles (
  user_id text primary key references "user" ("id") on delete cascade,
  role text not null default 'klub',
  venue_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  notes text not null default '',
  access_code text not null default '',
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists board_state (
  user_id text primary key references "user" ("id") on delete cascade,
  state text not null,
  updated_at timestamptz not null default now()
);

create table if not exists site_settings (
  id integer primary key,
  facebook text not null default '',
  instagram text not null default '',
  youtube text not null default '',
  contact_email text not null default '',
  contact_phone text not null default ''
);

insert into site_settings (id) values (1) on conflict (id) do nothing;
