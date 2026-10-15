-- Chốt công theo tháng: sau khi chốt, không duyệt thêm đơn sửa công / tăng ca của tháng đó.
create table if not exists timesheet_locks (
  company_id text not null references companies (id),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  locked_by text not null references profiles (user_id),
  locked_at timestamptz not null default now(),
  primary key (company_id, month)
);
