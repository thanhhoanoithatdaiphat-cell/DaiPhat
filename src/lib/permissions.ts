export type PermKind = "geolocation" | "camera";
export type PermState = "granted" | "denied" | "prompt" | "unknown";

/**
 * Hỏi trình duyệt xem quyền đang ở trạng thái nào mà KHÔNG làm hiện hộp xin quyền.
 * Trình duyệt không hỗ trợ (một số bản Safari) trả về "unknown" → app đi theo luồng cũ.
 */
export async function queryPerm(kind: PermKind): Promise<PermState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

export type PermEnv = {
  ios: boolean;
  android: boolean;
  standalone: boolean;
  /** Đang mở trong trình duyệt nhúng của Zalo / Facebook / Messenger... (không đổi được quyền ở đây). */
  inApp: boolean;
};

export function detectEnv(): PermEnv {
  if (typeof navigator === "undefined") return { ios: false, android: false, standalone: false, inApp: false };
  const ua = navigator.userAgent;
  return {
    ios: /iphone|ipad|ipod/i.test(ua),
    android: /android/i.test(ua),
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true,
    inApp: /zalo|fban|fbav|fb_iab|messenger|instagram|line\//i.test(ua),
  };
}
