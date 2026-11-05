-- Chống giả GPS: lưu sai số GPS của từng lượt chấm và các dấu hiệu bất thường server phát hiện được.
-- gps_flags là danh sách mã cách nhau bởi dấu phẩy (rỗng = bình thường), ví dụ "teleport:12.4:5,same_other".
alter table attendances add column if not exists gps_accuracy integer;
alter table attendances add column if not exists gps_flags text not null default '';
-- Chỉ mục nhỏ để tìm nhanh các lượt có toạ độ trùng khít (chỉ những lượt GPS có sai số rất nhỏ).
create index if not exists attendances_gps_grade_idx on attendances (lat, lng) where gps_accuracy <= 10;
