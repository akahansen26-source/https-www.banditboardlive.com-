alter table profiles add column if not exists overlay_key text;

create unique index if not exists profiles_overlay_key_idx on profiles (overlay_key);
