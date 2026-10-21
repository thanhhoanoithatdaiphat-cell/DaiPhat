-- Ca làm có nghỉ trưa 11:30–13:30 (nhân viên chỉ chấm vào đầu ca và ra cuối ca),
-- tăng ca tính từ 30 phút. Chỉ bổ sung khi công ty chưa có các khóa này.
update companies
set settings = coalesce(settings, '{}'::jsonb)
  || case when settings ? 'lunchStart' then '{}'::jsonb else '{"lunchStart":"11:30"}'::jsonb end
  || case when settings ? 'lunchEnd' then '{}'::jsonb else '{"lunchEnd":"13:30"}'::jsonb end
  || case when settings ? 'overtimeMinMinutes' then '{}'::jsonb else '{"overtimeMinMinutes":30}'::jsonb end;
