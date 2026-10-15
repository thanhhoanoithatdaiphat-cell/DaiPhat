create table if not exists companies (
  id text primary key,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id text primary key,
  company_id text not null references companies (id),
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'employee' check (role in ('employee', 'approver', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id serial primary key,
  company_id text not null references companies (id),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_meters integer not null,
  is_active boolean not null default true
);

create index if not exists locations_company_idx on locations (company_id);

create table if not exists attendances (
  id serial primary key,
  user_id text not null references profiles (user_id),
  company_id text not null references companies (id),
  type text not null check (type in ('in', 'out')),
  punched_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  photo_data text,
  status text not null check (status in ('valid', 'corrected')),
  nearest_name text,
  distance_meters integer,
  location_source text not null default 'gps' check (location_source in ('gps', 'manual')),
  note text
);

create index if not exists attendances_user_time_idx on attendances (user_id, punched_at desc);
create index if not exists attendances_company_time_idx on attendances (company_id, punched_at desc);

create table if not exists correction_requests (
  id serial primary key,
  user_id text not null references profiles (user_id),
  company_id text not null references companies (id),
  attendance_date date not null,
  punch_type text not null check (punch_type in ('in', 'out')),
  requested_time text not null,
  kind text not null,
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists corrections_company_status_idx on correction_requests (company_id, status);

insert into companies (id, name, settings)
values (
  'co-default',
  'Công ty của bạn',
  '{"workStart":"08:00","workEnd":"17:30","lateMinutes":15,"maxCorrections":4,"rankingsEnabled":false,"requirePhoto":true}'::jsonb
)
on conflict (id) do nothing;

insert into locations (company_id, name, lat, lng, radius_meters)
select 'co-default', 'Văn phòng', 21.028511, 105.854200, 200
where not exists (
  select 1 from locations where company_id = 'co-default' and name = 'Văn phòng'
);

insert into locations (company_id, name, lat, lng, radius_meters)
select 'co-default', 'Kho hàng', 21.040800, 105.820100, 180
where not exists (
  select 1 from locations where company_id = 'co-default' and name = 'Kho hàng'
);
