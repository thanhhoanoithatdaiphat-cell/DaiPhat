import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, X } from "lucide-react";
import { detectEnv, queryPerm, type PermEnv, type PermKind } from "@/lib/permissions";
import { primaryBtn, secondaryBtn } from "@/components/ui";

const LABEL: Record<PermKind, string> = { geolocation: "vị trí (GPS)", camera: "camera" };

function steps(env: PermEnv, need: PermKind[]): string[] {
  const both = need.length === 2;
  const what = both ? "Vị trí và Camera" : need[0] === "camera" ? "Camera" : "Vị trí";
  if (env.inApp) {
    return [
      "Bạn đang mở app trong Zalo/Facebook nên không đổi được quyền ở đây.",
      "Bấm nút ⋯ (hoặc ⋮) ở góc màn hình, chọn “Mở bằng trình duyệt” (Safari hoặc Chrome).",
      "Mở lại trang chấm công và cho phép khi được hỏi.",
    ];
  }
  if (env.ios) {
    return env.standalone
      ? [
          "Mở Cài đặt của iPhone → Quyền riêng tư & Bảo mật.",
          `Chọn ${both ? "Dịch vụ định vị và Camera" : need[0] === "camera" ? "Camera" : "Dịch vụ định vị"}, tìm app chấm công và bật lên.`,
          "Nếu không thấy app trong danh sách: mở trang bằng Safari để chấm công.",
          "Quay lại app, bấm “Tôi đã bật, thử lại”.",
        ]
      : [
          "Trên Safari, bấm biểu tượng “aA” bên trái thanh địa chỉ → Cài đặt trang web.",
          `Chuyển ${what} sang “Cho phép” (hoặc “Hỏi”).`,
          "Nếu vẫn không được: Cài đặt iPhone → Quyền riêng tư & Bảo mật → Dịch vụ định vị → bật, và Safari Websites chọn “Khi dùng ứng dụng”.",
          "Quay lại, bấm “Tôi đã bật, thử lại”.",
        ];
  }
  if (env.android) {
    return env.standalone
      ? [
          "Giữ biểu tượng app chấm công trên màn hình chính → Thông tin ứng dụng → Quyền.",
          `Bật ${what} (chọn “Chỉ cho phép khi dùng ứng dụng”).`,
          "Quay lại app, bấm “Tôi đã bật, thử lại”.",
        ]
      : [
          "Trên Chrome, bấm biểu tượng ổ khóa (hoặc ⚙) bên trái thanh địa chỉ → Quyền.",
          `Chọn ${what} → “Cho phép”.`,
          "Nếu trang tự tải lại thì cứ để nó tải xong, rồi bấm chấm công.",
        ];
  }
  return [
    "Bấm biểu tượng ổ khóa bên trái thanh địa chỉ.",
    `Bật ${what} cho trang này.`,
    "Tải lại trang rồi bấm chấm công.",
  ];
}

export function PermissionGuide({
  need,
  again,
  onRetry,
  onClose,
}: {
  need: PermKind[];
  /** true nếu người dùng đã bấm “thử lại” mà quyền vẫn bị chặn. */
  again: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [env, setEnv] = useState<PermEnv | null>(null);
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;

  useEffect(() => setEnv(detectEnv()), []);

  // Người dùng sang Cài đặt bật quyền rồi quay lại app: tự nhận ra và chạy tiếp, không bắt bấm thêm.
  useEffect(() => {
    let busy = false; // đặt đồng bộ, vì focus và visibilitychange thường bắn gần như cùng lúc
    async function check() {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        const states = await Promise.all(need.map((k) => queryPerm(k)));
        if (states.length > 0 && states.every((s) => s === "granted")) retryRef.current();
        else busy = false;
      } catch {
        busy = false;
      }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [need]);

  const list = env ? steps(env, need) : [];
  const title = need.length === 2 ? "Cần bật quyền Vị trí và Camera" : `Cần bật quyền ${LABEL[need[0]]}`;

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-card px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {need.includes("geolocation") ? <MapPin className="size-5 text-amber" /> : null}
            {need.includes("camera") ? <Camera className="size-5 text-amber" /> : null}
            <h2 className="font-display text-lg font-bold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="grid size-9 shrink-0 place-items-center rounded-full bg-sand">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Chấm công cần vị trí để biết bạn đang ở nơi làm việc và ảnh để xác nhận đúng người. Quyền này đang bị chặn trên máy bạn nên trình duyệt không hỏi lại được, bạn cần bật thủ công một lần.
        </p>
        {again ? (
          <p className="mt-3 rounded-lg bg-clay px-3 py-2 text-sm text-night">Quyền vẫn đang bị chặn. Làm theo các bước bên dưới rồi thử lại.</p>
        ) : null}
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
          {list.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="mt-5 grid gap-2">
          <button type="button" className={`${primaryBtn} h-11 w-full`} onClick={onRetry}>
            Tôi đã bật, thử lại
          </button>
          <button type="button" className={`${secondaryBtn} h-11 w-full`} onClick={onClose}>
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
