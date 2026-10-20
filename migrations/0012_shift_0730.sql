-- Công ty chỉ có một ca 07:30–17:30. Chỉ đổi những công ty còn giữ giờ vào mặc định cũ 08:00;
-- công ty đã tự chỉnh giờ khác thì giữ nguyên.
update companies
set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{workStart}', '"07:30"')
where coalesce(settings->>'workStart', '08:00') = '08:00';
