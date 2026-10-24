import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";

export type CardTone = "gold" | "clay" | "ok" | "ink";

const TONE: Record<CardTone, { ring: string; icon: string; num: string }> = {
  gold: { ring: "border-ice/50 bg-ice/[0.07]", icon: "bg-ice/20 text-ice", num: "text-ice" },
  clay: { ring: "border-clay/50 bg-clay/[0.07]", icon: "bg-clay/20 text-clay", num: "text-clay" },
  ok: { ring: "border-line bg-card", icon: "bg-ok/15 text-ok", num: "text-ok" },
  ink: { ring: "border-line bg-card", icon: "bg-sand text-ink", num: "text-ink" },
};

/** Thẻ tổng số: chạm vào để mở chi tiết. Số 0 thì mờ đi và không bấm được. */
export function AlertCard({
  icon: Icon,
  label,
  count,
  hint,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  /** Dòng phụ: tên vài người đầu, hoặc tổng giờ tăng ca */
  hint?: string;
  tone: CardTone;
  onClick?: () => void;
}) {
  const empty = count === 0;
  const t = empty ? TONE.ink : TONE[tone];
  return (
    <button
      type="button"
      disabled={empty || !onClick}
      onClick={onClick}
      aria-label={`${label}: ${count}${empty ? ", không có" : ", bấm để xem chi tiết"}`}
      className={`relative flex min-h-[7.25rem] flex-col justify-between rounded-2xl border p-3.5 text-left transition-transform active:scale-[0.98] disabled:cursor-default ${t.ring} ${empty ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between">
        <span className={`grid size-9 place-items-center rounded-full ${t.icon}`}>
          {empty ? <CircleCheck className="size-5" /> : <Icon className="size-5" />}
        </span>
        {!empty && onClick ? <ChevronRight className="size-5 text-muted" aria-hidden="true" /> : null}
      </div>
      <div>
        <p className="flex items-baseline gap-2">
          <span className={`font-display text-[2.6rem] leading-none font-bold tabular-nums ${empty ? "text-muted" : t.num}`}>{count}</span>
          <span className="text-sm font-semibold text-ink">{label}</span>
        </p>
        <p className="mt-1 truncate text-xs text-muted">{empty ? "Không có" : (hint ?? "Bấm để xem")}</p>
      </div>
    </button>
  );
}

/** Ô đếm nhỏ cho "Đang trong ca / Đã ra / Chưa chấm". */
export function CountTile({ label, count, onClick, tone = "ink" }: { label: string; count: number; onClick: () => void; tone?: CardTone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${count}, bấm để xem danh sách`}
      className="flex flex-col items-start rounded-2xl border border-line bg-card px-3.5 py-3 text-left transition-transform active:scale-[0.98]"
    >
      <span className={`font-display text-4xl leading-none font-bold tabular-nums ${count === 0 ? "text-muted" : TONE[tone].num}`}>{count}</span>
      <span className="mt-1.5 flex w-full items-center justify-between text-xs text-muted">
        {label}
        <ChevronRight className="size-4" aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * Trang chi tiết toàn màn hình. Nút Back của điện thoại (và phím Esc) quay về bảng quản trị:
 * mở trang thì thêm một mục vào lịch sử trình duyệt, Back sẽ bỏ mục đó thay vì thoát app.
 */
export function DetailPage({
  title,
  count,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const state = (history.state ?? {}) as Record<string, unknown>;
    if (!state.detailPage) history.pushState({ ...state, detailPage: true }, "");
    const onPop = () => onCloseRef.current();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") history.back();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="theme-night page-in fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      <header className="safe-top shrink-0 border-b border-line bg-night-deep px-3 pb-3">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 md:max-w-3xl">
          <button
            type="button"
            onClick={() => history.back()}
            aria-label="Quay lại"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-sand text-ink active:scale-95"
          >
            <ChevronLeft className="size-6" />
          </button>
          <div className="min-w-0 flex-1">
            {subtitle ? <p className="truncate text-xs font-semibold text-ice">{subtitle}</p> : null}
            <h2 className="truncate font-display text-2xl leading-tight font-semibold">{title}</h2>
          </div>
          {count != null ? (
            <span className="shrink-0 rounded-full bg-ice px-3 py-1 font-display text-xl font-bold text-night tabular-nums">{count}</span>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md space-y-2 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-3xl">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
