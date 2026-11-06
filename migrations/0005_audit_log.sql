create table if not exists audit_log (
  id text primary key,
  at timestamptz not null default now(),
  actor_id text,
  actor_name text not null default '',
  actor_role text not null default '',
  action text not null,
  detail text not null default ''
);

create index if not exists audit_log_at_idx on audit_log (at desc);
