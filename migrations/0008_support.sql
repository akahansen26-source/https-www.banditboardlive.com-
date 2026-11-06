create sequence if not exists support_ticket_seq start 1048;

create table if not exists support_tickets (
  id text primary key,
  number integer not null unique,
  guest_token text not null,
  user_id text,
  name text not null,
  email text not null,
  category text not null,
  subject text not null,
  tournament text not null default '',
  table_name text not null default '',
  status text not null default 'new',
  assignee_id text,
  assignee_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx on support_tickets (user_id);
create index if not exists support_tickets_status_idx on support_tickets (status, updated_at desc);

create table if not exists support_messages (
  id text primary key,
  ticket_id text not null references support_tickets (id) on delete cascade,
  author_id text,
  author_name text not null,
  author_role text not null default '',
  body text not null,
  internal boolean not null default false,
  attachment_name text not null default '',
  attachment_type text not null default '',
  attachment_data text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at);

create table if not exists support_rate (
  key text primary key,
  hits integer not null default 0,
  window_start timestamptz not null default now()
);
