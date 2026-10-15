-- Số điện thoại của tài khoản (dạng 84xxxxxxxxx), dùng để đặt lại mật khẩu bằng mã OTP qua SMS.
alter table "user" add column if not exists "phoneNumber" text unique;
alter table "user" add column if not exists "phoneNumberVerified" boolean default false;
