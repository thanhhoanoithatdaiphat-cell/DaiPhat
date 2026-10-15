update companies
set settings = jsonb_set(settings, '{lateMinutes}', '5')
where settings ->> 'lateMinutes' = '15';
