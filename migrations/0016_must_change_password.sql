-- Tài khoản do quản trị tạo/cấp lại mật khẩu: lần đăng nhập đầu tiên hỏi nhân viên đặt mật khẩu của riêng mình.
alter table profiles add column if not exists must_change_password boolean not null default false;
