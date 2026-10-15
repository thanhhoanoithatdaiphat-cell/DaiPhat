-- Mã mời công ty: nhân viên cần mã này để đăng ký. Mã được tạo khi quản trị mở Cài đặt lần đầu.
alter table companies add column if not exists invite_code text;
-- Tìm ảnh cũ để xóa nhanh (xóa ảnh sau 90 ngày, giữ lại bản ghi chấm công).
create index if not exists attendances_photo_old_idx on attendances (punched_at) where photo_data is not null;
