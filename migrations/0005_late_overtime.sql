alter table attendances add column if not exists late_minutes integer not null default 0;
alter table attendances add column if not exists overtime_minutes integer not null default 0;
alter table attendances add column if not exists overtime_status text not null default 'none';
