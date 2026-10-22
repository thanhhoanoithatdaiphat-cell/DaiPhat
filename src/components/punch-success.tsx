import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Clock3, TriangleAlert } from "lucide-react";
import type { PunchResult, Settings } from "@/lib/attendance-types";
import { VN, formatMeters, isEarlyOut, minutesToHm, vnWeekday } from "@/lib/vn-time";

export type PunchCelebration = {
  type: "in" | "out";
  result: PunchResult;
  /** Ảnh vừa chụp (data URL), dùng làm hình nhỏ trên nhãn "Hình ảnh có vị trí" */
  photo: string;
};

type Tone = "ok" | "warn" | "late";

const MESSAGES_IN_ON_TIME = [
  "Ngày hôm nay của bạn thế nào! Hãy mang theo năng lượng, lòng nhiệt huyết để cháy cùng nhau nhé!",
  "Đến đúng giờ là đã thắng một nửa rồi. Chúc bạn một ca làm thật suôn sẻ!",
  "Một ngày mới, một khởi đầu mới. Cà phê đã sẵn sàng chưa nào?",
  "Có bạn, cả đội thêm vui. Hôm nay mình cùng bứt phá nhé!",
];
const MESSAGES_IN_LATE = [
  "Không sao, quan trọng là bạn đã có mặt. Hôm nay mình bứt phá bù lại nhé!",
  "Có mặt là tốt rồi. Hít một hơi thật sâu và bắt đầu thôi!",
];
const MESSAGES_IN_SUNDAY = [
  "Chủ nhật vẫn đi làm, cảm ơn sự chăm chỉ của bạn! Ca này được tính tăng ca.",
];
const MESSAGES_OUT = [
  "Một ngày làm việc tuyệt vời! Về nhà nghỉ ngơi và nạp lại năng lượng nhé.",
  "Cảm ơn bạn đã cống hiến hôm nay. Về nhà an toàn nhé!",
  "Hoàn thành ca rồi, bạn xứng đáng có một buổi tối thật thư thả!",
  "Cả đội cảm ơn bạn vì hôm nay. Hẹn gặp lại ngày mai!",
];

const CONFETTI_COLORS = ["#fcb300", "#ffd666", "#ff8a3d", "#6fd3a0", "#fff3d6"];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function timeWithSeconds(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function longDate(iso: string): string {
  const text = new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill="currentColor" />
    </svg>
  );
}

function CalendarIllustration() {
  return (
    <svg viewBox="0 0 240 140" className="ps-illus" aria-hidden="true">
      <defs>
        <clipPath id="ps-cal-clip">
          <rect x="70" y="26" width="100" height="86" rx="12" />
        </clipPath>
      </defs>
      {/* Nền thành phố mờ */}
      <g fill="rgba(255,243,214,0.06)">
        <rect x="6" y="80" width="24" height="40" />
        <rect x="30" y="62" width="24" height="58" />
        <rect x="54" y="90" width="16" height="30" />
        <rect x="172" y="74" width="20" height="46" />
        <rect x="192" y="54" width="26" height="66" />
        <rect x="218" y="86" width="18" height="34" />
        <rect x="0" y="118" width="240" height="2" />
      </g>
      {/* Lấp lánh */}
      <g fill="none" stroke="#fcb300" strokeWidth="2" strokeLinecap="round">
        <path className="ps-tw ps-tw-1" d="M44 34v8M40 38h8" />
        <path className="ps-tw ps-tw-2" d="M200 32v8M196 36h8" />
        <path className="ps-tw ps-tw-3" d="M186 14v6M183 17h6" />
        <path className="ps-tw ps-tw-4" d="M60 16v6M57 19h6" />
      </g>
      {/* Tờ lịch */}
      <g className="ps-cal">
        <rect x="70" y="26" width="100" height="86" rx="12" fill="#3a2f24" stroke="#fcb300" strokeWidth="2.5" />
        <rect x="70" y="26" width="100" height="22" fill="#fcb300" clipPath="url(#ps-cal-clip)" />
        <g stroke="#fff3d6" strokeWidth="3.5" strokeLinecap="round">
          <path d="M88 20v12M104 20v12M120 20v12M136 20v12M152 20v12" />
        </g>
        <g fill="#fcb300">
          <rect className="ps-sq ps-sq-1" x="80" y="58" width="16" height="16" rx="4" />
          <rect className="ps-sq ps-sq-2" x="102" y="58" width="16" height="16" rx="4" />
          <rect className="ps-sq ps-sq-3" x="146" y="58" width="16" height="16" rx="4" />
          <rect className="ps-sq ps-sq-4" x="124" y="82" width="16" height="16" rx="4" />
          <rect className="ps-sq ps-sq-5" x="146" y="82" width="16" height="16" rx="4" />
        </g>
        {/* Ô được đánh dấu */}
        <circle className="ps-ripple" cx="132" cy="66" r="9" fill="none" stroke="#6fd3a0" strokeWidth="2" />
        <rect className="ps-mark" x="124" y="58" width="16" height="16" rx="4" fill="#6fd3a0" />
        <path
          className="ps-tick"
          d="M127.5 66.5l3.2 3.2 5.8-6.6"
          fill="none"
          stroke="#1c130c"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function PunchSuccessDialog({
  celebration,
  settings,
  workedMinutes,
  onClose,
  onDetail,
}: {
  celebration: PunchCelebration;
  settings: Settings;
  /** Tổng phút đã làm hôm nay (đã gồm lần chấm vừa rồi) */
  workedMinutes: number;
  onClose: () => void;
  onDetail?: () => void;
}) {
  const { type, result, photo } = celebration;
  const ok = result.ok;
  const [closing, setClosing] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(
    (after?: () => void) => {
      setClosing(true);
      window.setTimeout(() => {
        onClose();
        after?.();
      }, 160);
    },
    [onClose],
  );

  // Nội dung chọn một lần khi mở, không đổi mỗi giây khi đồng hồ chạy
  const info = useMemo(() => {
    if (!result.ok) return null;
    const sunday = vnWeekday(result.punchedAt) === 0;
    const late = type === "in" && !sunday && result.lateMinutes >= settings.lateMinutes;
    const earlyOut = type === "out" && !sunday && isEarlyOut(result.punchedAt, settings.workEnd);
    let message: string;
    if (type === "out") message = pick(MESSAGES_OUT);
    else if (sunday) message = pick(MESSAGES_IN_SUNDAY);
    else if (late) message = pick(MESSAGES_IN_LATE);
    else message = pick(MESSAGES_IN_ON_TIME);

    let status: { text: string; tone: Tone };
    if (type === "in") {
      status = sunday
        ? { text: "Ca Chủ nhật · tính tăng ca", tone: "warn" }
        : late
          ? { text: `Muộn ${result.lateMinutes} phút`, tone: "late" }
          : { text: "Đúng giờ", tone: "ok" };
    } else {
      status = earlyOut ? { text: "Ra sớm", tone: "warn" } : { text: "Hoàn thành ca", tone: "ok" };
    }
    return { message, status, late, sunday };
  }, [result, type, settings.lateMinutes, settings.workEnd]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: 4 + Math.random() * 92,
        delay: Math.random() * 0.5,
        duration: 1.7 + Math.random() * 1.1,
        size: 5 + Math.random() * 6,
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 70,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    [],
  );

  useEffect(() => {
    if (ok) navigator.vibrate?.([40, 30, 60]);
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  const title = ok ? (type === "in" ? "Vào ca thành công" : "Ra ca thành công") : "Chưa chấm công được";
  const when = result.ok ? result.punchedAt : new Date().toISOString();
  const timeTone = !ok ? "bad" : info?.status.tone === "late" ? "late" : info?.status.tone === "warn" ? "warn" : "ok";
  const offsite = result.ok && result.offsite;
  const full = workedMinutes >= settings.fullDayMinutes;
  const half = workedMinutes >= settings.halfDayMinutes;

  return createPortal(
    <div
      className={`theme-night ps-overlay ${closing ? "ps-closing" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="ps-card" role="dialog" aria-modal="true" aria-labelledby="ps-title">
        {ok ? (
          <div className="ps-confetti" aria-hidden="true">
            {confetti.map((c, i) => (
              <span
                key={i}
                style={{
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.round ? c.size : c.size * 1.6,
                  background: c.color,
                  borderRadius: c.round ? "999px" : "2px",
                  animationDelay: `${c.delay}s`,
                  animationDuration: `${c.duration}s`,
                  ["--drift" as string]: `${c.drift}px`,
                  ["--rot" as string]: `${c.rotate}deg`,
                }}
              />
            ))}
          </div>
        ) : null}

        <header className={`ps-head ${ok ? "" : "ps-head-bad"}`}>
          {ok ? <Sparkle className="ps-star ps-star-l" /> : <TriangleAlert className="size-5" aria-hidden="true" />}
          <h2 id="ps-title">{title}</h2>
          {ok ? <Sparkle className="ps-star ps-star-r" /> : null}
        </header>

        <div className="ps-body">
          {ok ? (
            <CalendarIllustration />
          ) : (
            <div className="ps-bad-icon" aria-hidden="true">
              <MapPin className="size-9" />
            </div>
          )}

          <p className={`ps-time ps-time-${timeTone}`}>
            <Clock3 className="ps-time-icon" aria-hidden="true" />
            <span>{timeWithSeconds(when)}</span>
          </p>
          <p className="ps-date">{longDate(when)}</p>

          {ok ? (
            <>
              <p className="ps-via">
                qua
                <span className="ps-chip">
                  {photo ? <img src={photo} alt="" className="ps-thumb" /> : null}
                  Hình ảnh có vị trí
                </span>
              </p>

              <p className="ps-loc">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {offsite
                    ? "Ngoài điểm chấm công"
                    : result.ok
                      ? `${result.nearestName} · cách ${formatMeters(result.distanceMeters)}`
                      : ""}
                </span>
              </p>

              <div className="ps-pills">
                {info ? <span className={`ps-pill ps-pill-${info.status.tone}`}>{info.status.text}</span> : null}
                {result.ok && result.overtimeStatus === "pending" ? (
                  <span className="ps-pill ps-pill-warn">Tăng ca {minutesToHm(result.overtimeMinutes)} · chờ duyệt</span>
                ) : null}
                {type === "out" ? (
                  <span className={`ps-pill ${full ? "ps-pill-ok" : half ? "ps-pill-warn" : "ps-pill-late"}`}>
                    Đã làm {Math.floor(workedMinutes / 60)}h {String(workedMinutes % 60).padStart(2, "0")}
                    {full ? " · Đủ công" : half ? " · Đủ nửa công" : ""}
                  </span>
                ) : null}
              </div>
              {offsite ? <p className="ps-note">Quản trị và người duyệt đã được báo.</p> : null}

              <p className="ps-msg">{info?.message}</p>
            </>
          ) : (
            <p className="ps-msg ps-msg-bad">{result.ok ? "" : result.message}</p>
          )}

          <div className="ps-actions">
            <button type="button" className="ps-btn ps-btn-ghost" onClick={() => close()} ref={ok ? undefined : primaryRef}>
              {ok ? "Đóng" : "Đã hiểu"}
            </button>
            {ok && onDetail ? (
              <button type="button" className="ps-btn ps-btn-main" ref={primaryRef} onClick={() => close(onDetail)}>
                Xem chi tiết
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
