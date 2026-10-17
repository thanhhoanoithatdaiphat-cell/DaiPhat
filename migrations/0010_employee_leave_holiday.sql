-- Thêm trạng thái nhân viên, ngày nghỉ, ngày lễ.
-- is_active: false khi nghỉ việc; ended_on: ngày cuối cùng làm việc.
alter table profiles add column if not exists is_active boolean not null default true;
alter table profiles add column if not exists ended_on date;

-- Ngày lễ: không tính vắng.
create table if not exists holidays (
  company_id text not null references companies (id),
  date date not null,
  name text not null,
  primary key (company_id, date)
);

-- Đơn nghỉ phép / ốm / thai sản.
create table if not exists leave_requests (
  id serial primary key,
  user_id text not null references profiles (user_id),
  company_id text not null references companies (id),
  leave_date date not null,
  kind text not null check (kind in ('phep', 'om', 'thaisan', 'khac')),
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists leave_requests_company_status_idx on leave_requests (company_id, status);
create index if not exists leave_requests_user_date_idx on leave_requests (user_id, leave_date);
