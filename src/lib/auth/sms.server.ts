/**
 * Gửi SMS (chỉ chạy phía server). Mặc định dùng SpeedSMS; muốn đổi nhà cung cấp chỉ cần sửa hàm `sendSms`.
 * Biến môi trường:
 *   SPEEDSMS_TOKEN  - access token của SpeedSMS (bắt buộc ở production)
 *   SMS_TYPE        - loại tin SpeedSMS (mặc định 2; tin OTP/brandname dùng 3 hoặc 4 tùy gói đã đăng ký)
 *   SMS_SENDER      - tên brandname nếu có (tùy chọn)
 * Không có SPEEDSMS_TOKEN ở máy dev: mã được in ra console thay vì gửi.
 */
const ENDPOINT = "https://api.speedsms.vn/index.php/sms/send";

export async function sendSms(phone84: string, content: string): Promise<void> {
  const token = process.env.SPEEDSMS_TOKEN?.trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Thiếu SPEEDSMS_TOKEN: chưa thể gửi SMS ở production.");
    }
    console.log(`[sms:dev] gửi tới ${phone84}: ${content}`);
    return;
  }
  const body: Record<string, unknown> = {
    to: [phone84],
    content,
    sms_type: Number(process.env.SMS_TYPE) || 2,
  };
  const sender = process.env.SMS_SENDER?.trim();
  if (sender) body.sender = sender;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${token}:x`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { status?: string; message?: string; code?: string } | null;
  if (!res.ok || json?.status !== "success") {
    throw new Error(`SpeedSMS lỗi: ${json?.message ?? json?.code ?? res.status}`);
  }
}
