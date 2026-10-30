/** Thông báo khi tài khoản đang được gắn với máy khác. Giao diện so khớp đúng chuỗi này để hiện màn hình khóa. */
export const DEVICE_BLOCKED_MESSAGE = "Tài khoản này đã được gắn với một máy khác. Hãy nhờ quản trị cho phép đổi máy.";

/** Mã máy ngẫu nhiên lưu trong cookie và localStorage (cookie để server đọc, localStorage để khôi phục khi cookie mất). */
export function ensureDeviceId(): string {
  if (typeof document === "undefined") return "";
  let id = "";
  try {
    id = localStorage.getItem("vaoca_device") ?? "";
  } catch {
    /* bỏ qua */
  }
  const cookie = /(?:^|;\s*)vaoca_device=([A-Za-z0-9-]{16,64})/.exec(document.cookie)?.[1] ?? "";
  if (!id) id = cookie || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  if (cookie !== id) {
    document.cookie = `vaoca_device=${id}; Max-Age=63072000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  try {
    localStorage.setItem("vaoca_device", id);
  } catch {
    /* bỏ qua */
  }
  return id;
}
