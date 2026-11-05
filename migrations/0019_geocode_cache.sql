-- Bộ nhớ đệm địa chỉ: mỗi ô toạ độ (làm tròn 4 chữ số thập phân, khoảng 11 m) chỉ tra OpenStreetMap một lần.
-- Giờ cao điểm nhiều người chấm cùng một chỗ nên gần như mọi lượt dùng lại địa chỉ đã lưu.
create table if not exists geocode_cache (
  cell text primary key,
  address text not null,
  created_at timestamptz not null default now()
);
