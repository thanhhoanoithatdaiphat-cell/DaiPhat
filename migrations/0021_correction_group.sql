-- Đơn sửa công "thiếu cả giờ vào và giờ ra" gồm 2 dòng (vào + ra) dùng chung một group_id,
-- để tính 1 lượt trong hạn mức mỗi tháng và duyệt cùng lúc. Đơn một giờ có group_id rỗng như cũ.
alter table correction_requests add column if not exists group_id text;
create index if not exists correction_requests_group_idx on correction_requests (group_id) where group_id is not null;
