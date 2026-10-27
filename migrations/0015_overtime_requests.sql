-- Đơn tăng ca: tăng ca vào giờ nghỉ trưa mà việc chấm vào/ra không ghi nhận được.
create table if not exists overtime_requests (
  id serial primary key,
  user_id text not null references profiles (user_id),
  company_id text not null references companies (id),
  work_date date not null,
  start_time text not null,
  end_time text not null,
  minutes integer not null,
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists overtime_requests_company_status_idx on overtime_requests (company_id, status);
create index if not exists overtime_requests_user_date_idx on overtime_requests (user_id, work_date);
