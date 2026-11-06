alter table profiles add column if not exists account_status text not null default 'approved';
alter table profiles add column if not exists public_live boolean not null default false;
