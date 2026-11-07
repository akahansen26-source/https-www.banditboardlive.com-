create table if not exists cms_pages (
  id text primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  status text not null default 'draft',
  show_in_nav boolean not null default false,
  nav_order integer not null default 0,
  blocks text not null default '[]',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cms_pages_nav_idx on cms_pages (status, show_in_nav, nav_order);

create table if not exists cms_media (
  id text primary key,
  name text not null,
  mime text not null,
  size integer not null,
  alt text not null default '',
  data text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
