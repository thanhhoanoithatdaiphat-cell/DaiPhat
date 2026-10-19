-- Dấu vết duyệt tăng ca: ai duyệt, lúc nào (để hiện trong Lịch sử → Nhật ký duyệt).
alter table attendances add column if not exists overtime_reviewed_by text;
alter table attendances add column if not exists overtime_reviewed_at timestamptz;
