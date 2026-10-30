import { getRequest, setCookie } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { DEVICE_BLOCKED_MESSAGE } from "@/lib/device-shared";

/** Tên máy dễ đọc từ User-Agent, ví dụ "Samsung SM-A155F · Chrome" hoặc "iPhone · Safari". */
export function deviceLabelFromUa(ua: string): string {
  const android = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua);
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : android ? android[1].trim() : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Máy lạ";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /(CriOS|Chrome)\//.test(ua) ? "Chrome" : /(FxiOS|Firefox)\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

/** Làm mới cookie từ phía máy chủ để trình duyệt (nhất là Safari trên iPhone) không xóa sau 7 ngày. */
function refreshCookie(request: Request, deviceId: string) {
  try {
    setCookie("vaoca_device", deviceId, {
      maxAge: 63_072_000,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: new URL(request.url).protocol === "https:",
    });
  } catch {
    /* không bắt buộc */
  }
}

function readDeviceCookie(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)vaoca_device=([A-Za-z0-9-]{16,64})/.exec(raw);
  return m ? m[1] : null;
}

/**
 * Khóa một máy cho mỗi tài khoản. Quản trị được miễn (cần dùng cả máy tính lẫn điện thoại).
 * Máy đầu tiên mở app được gắn vào tài khoản; máy khác bị chặn và được ghi lại để quản trị thấy.
 */
export async function assertDeviceAllowed(profile: { userId: string; companyId: string; role: string }): Promise<void> {
  if (profile.role === "admin") return;
  const sql = await getSql();
  const company = await sql<{ settings: unknown }>`select settings from companies where id = ${profile.companyId}`;
  let raw = company[0]?.settings;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if ((raw as { deviceLock?: unknown } | null)?.deviceLock === false) return;

  const request = getRequest();
  if (!request) return;
  const deviceId = readDeviceCookie(request);
  if (!deviceId) throw new Error("Hãy tải lại trang rồi thử lại.");
  const label = deviceLabelFromUa(request.headers.get("user-agent") ?? "");

  try {
    let rows = await sql<{ device_id: string }>`select device_id from user_devices where user_id = ${profile.userId}`;
    if (!rows[0]) {
      await sql`
        insert into user_devices (user_id, device_id, device_label)
        values (${profile.userId}, ${deviceId}, ${label})
        on conflict (user_id) do nothing
      `;
      rows = await sql<{ device_id: string }>`select device_id from user_devices where user_id = ${profile.userId}`;
    }
    if (rows[0]?.device_id === deviceId) {
      await sql`update user_devices set last_seen_at = now() where user_id = ${profile.userId} and last_seen_at < now() - interval '10 minutes'`;
      refreshCookie(request, deviceId);
      return;
    }
    // Tài khoản chưa có lượt chấm công nào thì chưa có gì để gian lận: cho đổi máy tự do.
    // (Người mới đăng ký hay mở link bằng Zalo rồi chuyển sang Chrome, hoặc cài ứng dụng sau khi đăng ký.)
    const used = await sql<{ n: number }>`select count(*)::int as n from attendances where user_id = ${profile.userId} limit 1`;
    if (Number(used[0]?.n ?? 0) === 0) {
      await sql`
        update user_devices
        set device_id = ${deviceId}, device_label = ${label}, bound_at = now(), last_seen_at = now()
        where user_id = ${profile.userId}
      `;
      refreshCookie(request, deviceId);
      return;
    }
    await sql`
      update user_devices
      set blocked_count = blocked_count + case when last_blocked_at is null or last_blocked_at < now() - interval '10 minutes' then 1 else 0 end,
          last_blocked_at = now(), last_blocked_label = ${label}
      where user_id = ${profile.userId}
    `;
  } catch (err) {
    // Lỗi cơ sở dữ liệu (ví dụ chưa có bảng) không được khóa nhân viên khỏi việc chấm công.
    console.warn("[device] check skipped:", err instanceof Error ? err.message : err);
    return;
  }
  throw new Error(DEVICE_BLOCKED_MESSAGE);
}
