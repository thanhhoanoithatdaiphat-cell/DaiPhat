import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { getPunchPhoto } from "@/lib/attendance.functions";

/** Bấm hoặc chạm ra ngoài vùng `ref` thì gọi onAway (dùng để đóng bảng chi tiết đang mở). */
export function useClickAway(ref: RefObject<HTMLElement | null>, onAway: () => void, enabled: boolean) {
  const cb = useRef(onAway);
  cb.current = onAway;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) cb.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ref, enabled]);
}

export const KIND_LABEL: Record<string, string> = {
  quen: "Quên chấm",
  gps: "Lỗi GPS",
  congtac: "Đi công tác",
  khac: "Khác",
};

export const LEAVE_LABEL: Record<string, string> = {
  phep: "Nghỉ phép",
  om: "Nghỉ ốm",
  thaisan: "Thai sản",
  khac: "Nghỉ khác",
};

export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(d)}/${Number(m)}`;
}

export function Chip({ tone, children }: { tone: "ink" | "ok" | "late" | "clay" | "muted"; children: ReactNode }) {
  const cls = {
    ink: "bg-ink text-card",
    ok: "bg-ok/15 text-ok",
    late: "bg-ice text-ink",
    clay: "bg-clay text-card",
    muted: "bg-sand text-muted",
  }[tone];
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>{children}</span>;
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-card ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PunchPhoto({ id }: { id: number }) {
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  useEffect(() => setPhoto(undefined), [id]);
  if (photo === undefined) {
    return (
      <button
        type="button"
        className="text-sm font-semibold underline"
        onClick={() => void getPunchPhoto({ data: id }).then((r) => setPhoto(r.photo)).catch(() => setPhoto(null))}
      >
        Xem ảnh chấm công
      </button>
    );
  }
  if (!photo) return <p className="text-sm text-muted">Không có ảnh</p>;
  return <img src={photo} alt="Ảnh chấm công" className="max-h-72 w-full rounded-md object-cover" />;
}

/** Banner tối đầu mỗi trang quản trị: tiêu đề, dòng phụ, nút thao tác và (tuỳ chọn) hàng số liệu. */
export function PageHero({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-night p-5 text-[#fff3d6] lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-tight font-bold lg:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-xs text-ice">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
