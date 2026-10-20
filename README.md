# Vào Ca – chấm công (Đại Phát)

Web app PWA: nhân viên chấm công bằng GPS + ảnh, quản lý duyệt đơn, xuất bảng công.
Công nghệ: TanStack Start + Nitro, Better Auth (số điện thoại + mật khẩu), Postgres (Neon).

## Chạy thử ở máy
```
npm install
npm run dev     # http://localhost:8080
```
Không cần cấu hình: không có `DATABASE_URL` thì app dùng DB tạm trong bộ nhớ (mất dữ liệu khi tắt).
GPS và camera cần HTTPS; localhost vẫn được trình duyệt cho phép.

## Deploy lên Vercel
1. **Neon** (neon.tech): tạo project Postgres, copy chuỗi kết nối bản *pooled*.
2. **Vercel**: Import repo (Framework: Other/Vite, để mặc định Build Command `npm run build`).
3. Đặt Environment Variables:
   - `DATABASE_URL` = chuỗi Neon
   - `BETTER_AUTH_SECRET` = chuỗi ngẫu nhiên dài (`openssl rand -base64 32`)
   - `BETTER_AUTH_URL` = địa chỉ chính thức, ví dụ `https://vaoca.vercel.app` (bắt buộc đặt nếu dùng tên miền riêng)
   - `SPEEDSMS_TOKEN` = access token SpeedSMS (gửi mã OTP đặt lại mật khẩu)
   - `SMS_TYPE` (tùy chọn) = loại tin SpeedSMS, mặc định 2; dùng 3 hoặc 4 nếu bạn đã đăng ký brandname/OTP
   - `SMS_SENDER` (tùy chọn) = tên brandname
   - `CRON_SECRET` = chuỗi ngẫu nhiên dài (bắt buộc để tác vụ xóa ảnh cũ chạy, xem bên dưới)
   - `TRUSTED_ORIGINS` (tùy chọn) = các origin khác, cách nhau bằng dấu phẩy
4. Deploy. Bảng dữ liệu tự tạo trong bước build (`npm run db:migrate`).
5. **Tài khoản đăng ký đầu tiên tự thành quản trị viên và không cần mã mời.** Hãy tự đăng ký trước khi gửi link cho nhân viên, rồi vào Nhân viên lấy **mã mời công ty** gửi cho nhân viên.

Production thiếu `DATABASE_URL` hoặc `BETTER_AUTH_SECRET` sẽ báo lỗi rõ ràng thay vì chạy sai.

## Đăng ký, đăng nhập, quên mật khẩu
- Đăng ký và đăng nhập bằng số điện thoại + mật khẩu (tối thiểu 8 ký tự).
- Quên mật khẩu: nhập số điện thoại, nhận mã 6 số qua SMS (hiệu lực 5 phút, nhập sai tối đa 3 lần), đặt mật khẩu mới.
- Mỗi số tối đa 3 mã mỗi giờ. Số chưa có tài khoản vẫn nhận phản hồi giống hệt, không bị lộ.
- Ở máy dev không có `SPEEDSMS_TOKEN`: mã in ra console, không gửi SMS thật.

## Mã mời công ty
- Từ tài khoản thứ hai trở đi, người đăng ký phải nhập mã mời (kiểm tra ở server, không vượt qua được bằng cách bỏ qua giao diện).
- Quản trị xem và tạo mã mới ở `/admin` → Nhân viên (hoặc tab Quản trị trên điện thoại). Tạo mã mới thì mã cũ hết hiệu lực, tài khoản đã có không bị ảnh hưởng.
- Nếu công ty chưa có mã (quản trị chưa mở Cài đặt lần nào), đăng ký bị đóng cho tới khi quản trị lấy mã.

## Tự xóa ảnh chấm công cũ
- Mỗi ngày lúc 03:00 (giờ Việt Nam) Vercel Cron gọi `/api/cron/cleanup` để xóa ảnh chấm công cũ hơn 60 ngày. Giờ, vị trí và trạng thái vẫn được giữ, chỉ mất ảnh.
- Cần đặt `CRON_SECRET` trên Vercel; Vercel tự gửi kèm khi gọi cron. Thiếu biến này thì tác vụ từ chối chạy.
- Kiểm tra trong Vercel → Settings → Cron Jobs rằng tác vụ đã được đăng ký và gói của bạn cho phép chạy mỗi ngày.
- Đổi số ngày giữ ảnh bằng hằng số `PHOTO_RETENTION_DAYS` trong `src/routes/api/cron/cleanup.ts`.

## Bản web quản trị (`/admin`)
Dành cho tài khoản **Quản trị** và **Người duyệt** (vai trò đặt trong Cài đặt → Nhân viên). Nhân viên thường vào sẽ thấy thông báo không đủ quyền.
- **Tổng quan**: số người đang làm / đã ra / chưa vào / đi muộn, lọc theo từng nhóm, tự làm mới mỗi 30 giây.
- **Cần duyệt**: bảng gom đơn sửa công, nghỉ phép và tăng ca (loại đơn, nhân viên kèm mã/phòng ban, nội dung, thời gian); có ô tìm theo tên. Chọn nhiều mục để duyệt cùng lúc. Phím tắt J/K chọn dòng, X đánh dấu, A duyệt, R từ chối. Tab "Đã xử lý" (gồm cả đơn nghỉ) cho biết ai duyệt, khi nào. Duyệt đơn nghỉ xong, ngày đó hiện chữ P/Ố/T trong bảng công và không tính vắng.
- **Bảng công**: lưới nhân viên × ngày theo tháng, bấm một ô để xem từng lần chấm, địa điểm, ảnh. Lọc theo phòng ban, tìm theo tên hoặc mã nhân viên. Xuất CSV. Quản trị có thể **chốt công** tháng đã kết thúc (khóa việc duyệt thêm đơn/tăng ca của tháng đó) và mở khóa khi cần.
- **Nhân viên** (chỉ quản trị): bảng nhân viên có tìm kiếm, lọc phòng ban / đang làm / đã nghỉ, cảnh báo người thiếu mã NV hoặc phòng ban; bấm một dòng để sửa hồ sơ, đổi vai trò, cho nghỉ việc; chứa mã mời công ty.
- **Cài đặt** (chỉ quản trị): ca làm, ngưỡng tính công, địa điểm, **ngày lễ** (hiện chữ L trong bảng công, không tính vắng).
- Công mỗi ngày tự tính theo tổng giờ làm (cộng từng đoạn vào–ra): từ ngưỡng "đủ công" (mặc định 7 giờ) là 1, từ ngưỡng "nửa công" (mặc định 4 giờ) là 0.5, thấp hơn là 0; thiếu giờ ra ở ngày đã qua là 0 cho tới khi có đơn sửa công. Ngưỡng chỉnh trong Cài đặt. Bảng công có nút đổi giữa xem "Công" và "Giờ vào", và hiện cảnh báo số ngày thiếu giờ / đơn chưa duyệt trước khi chốt công. File CSV có thêm cột Công.
Quy ước ô công: Chủ nhật là ngày nghỉ; ngày quá khứ không chấm là "Vắng"; ngày trước `started_on` của nhân viên không tính vắng.

## Đơn nghỉ phép
Nhân viên gửi đơn trong tab Đơn (mỗi đơn một ngày: phép, ốm, thai sản, khác; không gửi trùng ngày). Quản trị và người duyệt xử lý ở `/admin` → Cần duyệt, hoặc ngay trên điện thoại. Không tự duyệt đơn của mình (trừ khi công ty chỉ có một người duyệt). Tháng đã chốt công thì không gửi/duyệt thêm.

## Làm APK
`public/.well-known/assetlinks.json` đã khai báo gói `vn.daiphat.vaoca`. Dùng PWABuilder hoặc Bubblewrap (Trusted Web Activity)
trỏ tới địa chỉ Vercel, rồi điền `sha256_cert_fingerprints` của khóa ký APK vào file này và deploy lại.
# DaiPhat

## Giao diện mới (nền tối nâu đen + vàng logo)
- Màu nằm ở `src/styles.css`: bảng màu sáng (trang quản trị `/admin`) ở khối `@theme`, nền tối cho app điện thoại và đăng nhập ở lớp `.theme-dark`.
- Logo công ty: `public/punch-logo.png` (giữ nguyên bản gốc). Icon cài app: `public/icon-*.png`.
- Nút chấm công: lớp `.punch-float` trong `src/styles.css`.
