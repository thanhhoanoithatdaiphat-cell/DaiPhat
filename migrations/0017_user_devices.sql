-- Mỗi tài khoản (trừ quản trị) chỉ dùng trên một máy: máy đầu tiên mở app được gắn vào tài khoản.
create table if not exists user_devices (
  user_id text primary key references profiles (user_id) on delete cascade,
  device_id text not null,
  device_label text not null default '',
  bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  blocked_count integer not null default 0,
  last_blocked_at timestamptz,
  last_blocked_label text
);
