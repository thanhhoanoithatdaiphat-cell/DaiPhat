-- Mỗi nhân viên chỉ có 1 lượt "vào" và 1 lượt "ra" chấm trực tiếp (status = 'valid') mỗi ngày (giờ Việt Nam).
-- Đây là lớp chặn cuối cùng ở cơ sở dữ liệu: dù bấm đúp hay hai yêu cầu đến cùng lúc, lượt thứ hai bị từ chối.
-- Chỉ áp dụng từ ngày mai (theo giờ Việt Nam) để không đụng dữ liệu cũ đã có nhiều lượt trong một ngày.
-- Đơn sửa công đã duyệt (status = 'corrected') không bị ràng buộc.
-- Nếu vì lý do nào đó không tạo được chỉ mục, migration vẫn thành công (ứng dụng vẫn kiểm tra ở mã) và không làm hỏng lần triển khai.
do $$
declare
  cutoff date := ((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1);
begin
  if not exists (select 1 from pg_indexes where indexname = 'attendances_one_punch_per_day_idx') then
    execute format(
      'create unique index attendances_one_punch_per_day_idx on attendances (user_id, type, ((punched_at at time zone ''Asia/Ho_Chi_Minh'')::date)) where status = ''valid'' and ((punched_at at time zone ''Asia/Ho_Chi_Minh'')::date) >= date %L',
      cutoff
    );
  end if;
exception when others then
  raise notice 'Bỏ qua chỉ mục một lượt mỗi ngày: %', sqlerrm;
end $$;
