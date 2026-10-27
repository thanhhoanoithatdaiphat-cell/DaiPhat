import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { displayPhone, phoneFromLoginEmail } from "@/lib/phone";
import { workedMinutes } from "@/lib/month-grid";
import { CameraSheet } from "@/components/camera-sheet";
import { errorText, fieldClass, primaryBtn, secondaryBtn } from "@/components/ui";
import { InviteCodeCard } from "@/components/invite-card";
import {
  createCorrection,
  createLeaveRequest,
  getPunchPhoto,
  listCorrections,
  getMySummary,
  listLeaves,
  listHistory,
  listRankings,
  exportTimesheet,
  punch,
  reviewCorrection,
  reviewLeave,
  reviewOvertime,
  saveCompany,
  saveLocation,
  setRole,
  adminUpdateProfile,
  updateProfile,
} from "@/lib/attendance.functions";
import type {
  CorrectionRow,
  LeaveRow,
  LocationRow,
  MySummary,
  PersonRow,
  PunchResult,
  PunchRow,
  RankLists,
  Role,
  Settings,
  WorkspaceData,
} from "@/lib/attendance-types";
import { scheduleOf } from "@/lib/attendance-types";
import { compareByCode } from "@/lib/employee-order";
import {
  formatMeters,
  formatMonthLabel,
  formatVnDay,
  isEarlyOut,
  minutesToHm,
  mondayIndex,
  daysInMonth,
  shiftMonth,
  vnDateKey,
  vnMonthKey,
  vnTime,
  vnWeekday,
  VN,
} from "@/lib/vn-time";


function isLate(lateMinutes: number, grace: number): boolean {
  return lateMinutes >= Math.max(0, grace);
}

const KIND_LABEL: Record<string, string> = {
  quen: "Quên chấm",
  gps: "GPS lỗi",
  congtac: "Công tác ngoài",
  khac: "Khác",
};

const ROLE_LABEL: Record<Role, string> = {
  employee: "Nhân viên",
  approver: "Người duyệt",
  admin: "Quản trị",
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: VN, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  const hello = hour < 11 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  return { time, hello };
}

function punchLabel(row: PunchRow, settings: Settings): string {
  if (row.status === "corrected") return row.type === "in" ? "Vào — đã sửa" : "Ra — đã sửa";
  if (row.type === "in") {
    if (vnWeekday(row.punchedAt) === 0) return "Vào ca";
    return isLate(row.lateMinutes, settings.lateMinutes) ? `Muộn ${row.lateMinutes} phút` : "Đúng giờ";
  }
  if (vnWeekday(row.punchedAt) === 0) return "Ra ca";
  return isEarlyOut(row.punchedAt, settings.workEnd) ? "Ra sớm" : "Ra ca";
}

function Badge({ tone, children }: { tone: "ok" | "late" | "muted"; children: string }) {
  const toneClass =
    tone === "ok" ? "bg-ink text-card" : tone === "late" ? "bg-clay text-card" : "bg-sand text-muted";
  return <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${toneClass}`}>{children}</span>;
}

function toneFor(row: PunchRow, settings: Settings): "ok" | "late" | "muted" {
  if (row.status === "corrected") return "muted";
  if (row.type === "in" && isLate(row.lateMinutes, settings.lateMinutes)) return "late";
  if (row.type === "out" && vnWeekday(row.punchedAt) !== 0 && isEarlyOut(row.punchedAt, settings.workEnd)) return "late";
  return "ok";
}

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

type GeoState =
  | { status: "wait" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "ok"; lat: number; lng: number; accuracy: number };

/** Theo dõi GPS liên tục để thẻ vị trí hiện đúng khoảng cách tới điểm chấm công. */
function useGeoWatch(): GeoState {
  const [geo, setGeo] = useState<GeoState>({ status: "wait" });
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeo({ status: "unsupported" });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setGeo({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setGeo(err.code === 1 ? { status: "denied" } : { status: "wait" }),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return geo;
}

function liveWorkedMinutes(rows: PunchRow[], nowMs: number, settings: Settings): number {
  const points: { type: "in" | "out"; at: string }[] = rows.map((r) => ({ type: r.type, at: r.punchedAt }));
  const last = rows[rows.length - 1];
  // Đang trong ca: tính tạm đến giờ hiện tại
  if (last?.type === "in") points.push({ type: "out", at: new Date(nowMs).toISOString() });
  return workedMinutes(points, { schedule: scheduleOf(settings), clip: vnWeekday() !== 0 });
}

function dateLine(): string {
  const weekday = new Intl.DateTimeFormat("vi-VN", { timeZone: VN, weekday: "long" }).format(new Date());
  const [y, m, d] = vnDateKey().split("-");
  return `${weekday}, ${d}/${m}/${y}`;
}

function congText(n: number): string {
  return String(n).replace(".", ",");
}

export function PunchPanel({
  data,
  onChanged,
  onGoRequests,
}: {
  data: WorkspaceData;
  onChanged: () => Promise<void>;
  onGoRequests: () => void;
}) {
  const [cameraFor, setCameraFor] = useState<"in" | "out" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PunchResult | null>(null);
  const [geoFailed, setGeoFailed] = useState<"in" | "out" | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState("");
  const [pendingLoc, setPendingLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const active = data.locations.filter((loc) => loc.isActive);
  const last = data.today[data.today.length - 1];
  const clock = useClock();
  const primary: "in" | "out" = last?.type === "in" ? "out" : "in";
  const geo = useGeoWatch();
  const [summary, setSummary] = useState<MySummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMySummary({ data: vnMonthKey() })
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data.today.length]);
  const nowMs = Date.now();
  const firstIn = data.today.find((row) => row.type === "in") ?? null;
  const worked = liveWorkedMinutes(data.today, nowMs, data.settings);
  const inLate = firstIn ? isLate(firstIn.lateMinutes, data.settings.lateMinutes) : false;
  const nearest = (() => {
    if (geo.status !== "ok" || active.length === 0) return null;
    let best: { name: string; dist: number; radius: number } | null = null;
    for (const loc of active) {
      const dist = distanceM(geo.lat, geo.lng, loc.lat, loc.lng);
      if (!best || dist < best.dist) best = { name: loc.name, dist, radius: loc.radiusMeters };
    }
    return best;
  })();
  const gpsLabel =
    geo.status === "ok"
      ? geo.accuracy <= 50
        ? { text: "GPS tốt", cls: "text-ok" }
        : geo.accuracy <= 150
          ? { text: "GPS yếu", cls: "text-ice" }
          : { text: "GPS kém", cls: "text-clay" }
      : geo.status === "wait"
        ? { text: "Đang định vị…", cls: "text-muted" }
        : { text: "Chưa có GPS", cls: "text-clay" };
  const monthNo = Number(vnMonthKey().slice(5));
  const cong = summary?.cong ?? 0;
  const standard = summary?.standardDays ?? 0;

  async function submit(type: "in" | "out", lat: number, lng: number, photo: string, locationSource: "gps" | "manual", accuracy?: number) {
    setBusy(true);
    setError("");
    try {
      const next = await punch({ data: { type, lat, lng, photo, locationSource, accuracy } });
      setResult(next);
      setGeoFailed(null);
      setPendingPhoto("");
      if (next.ok) await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function locateFirst(type: "in" | "out") {
    setBusy(true);
    setError("");
    setPendingLoc(null);
    if (!navigator.geolocation) {
      setGeoFailed(type);
      setBusy(false);
      setError("Máy không có GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        if (acc != null && acc > 150) {
          setGeoFailed(type);
          setBusy(false);
          setError(`GPS không chính xác (sai số ~${Math.round(acc)} m). Ra nơi thoáng hơn rồi thử lại.`);
          return;
        }
        setPendingLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setCameraFor(type);
        setBusy(false);
      },
      () => {
        setGeoFailed(type);
        setBusy(false);
        setError("Chưa lấy được GPS. Bật định vị rồi thử lại.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function locateThenSubmit(type: "in" | "out", photo: string) {
    setBusy(true);
    setError("");
    if (!navigator.geolocation) {
      setPendingPhoto(photo);
      setGeoFailed(type);
      setBusy(false);
      setError("Máy không có GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        if (acc != null && acc > 150) {
          setPendingPhoto(photo);
          setGeoFailed(type);
          setBusy(false);
          setError(`GPS không chính xác (sai số ~${Math.round(acc)} m). Ra nơi thoáng hơn rồi thử lại.`);
          return;
        }
        void submit(type, pos.coords.latitude, pos.coords.longitude, photo, "gps");
      },
      () => {
        setPendingPhoto(photo);
        setGeoFailed(type);
        setBusy(false);
        setError("Chưa lấy được GPS. Bật định vị rồi thử lại.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="pz flex h-full min-h-0 flex-col gap-[clamp(0.4rem,1.7dvh,1.25rem)] pb-4">
      <section className="flex shrink-0 items-start justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] md:px-8">
        <div className="min-w-0">
          <p className="text-xs text-muted">{dateLine()}</p>
          <h1 className="pz-title font-display mt-0.5 truncate text-[1.6rem] leading-tight font-bold text-ink md:text-4xl">
            Chào {data.profile.fullName}
          </h1>
        </div>
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-night-deep ring-2 ring-ice">
          <img src={data.profile.avatar || "/punch-logo-dark.png"} alt="" className="size-full object-cover" />
        </span>
      </section>

      <div className="mx-5 flex shrink-0 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 md:mx-8">
        <MapPin className="size-5 shrink-0 text-ice" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {nearest?.name ?? (active[0]?.name || "Điểm chấm công")}
          </p>
          <p className={`pz-hide-tight truncate text-xs ${nearest && nearest.dist > nearest.radius ? "text-clay" : "text-muted"}`}>
            {nearest
              ? nearest.dist <= nearest.radius
                ? `Trong phạm vi · cách ${formatMeters(nearest.dist)}`
                : `Ngoài phạm vi · cách ${formatMeters(nearest.dist)}`
              : active.length === 0
                ? "Chưa có điểm chấm công đang bật"
                : geo.status === "denied"
                  ? "Hãy bật định vị cho trình duyệt"
                  : geo.status === "unsupported"
                    ? "Máy không hỗ trợ GPS"
                    : "Đang xác định vị trí của bạn…"}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${gpsLabel.cls}`}>{gpsLabel.text}</span>
      </div>

      <div className="shrink-0 text-center">
        <p className="pz-clock font-display text-[clamp(2.75rem,8dvh,4.5rem)] leading-none font-bold tabular-nums text-ink md:text-[6.5rem]">
          {clock.time.slice(0, 5)}
        </p>
        <p className="pz-hide-compact mt-1 text-xs text-muted">
          Ca ngày · {data.settings.workStart} – {data.settings.workEnd} · nghỉ trưa {data.settings.lunchStart}–{data.settings.lunchEnd}
        </p>
      </div>

      <div className="punch-zone flex min-h-0 flex-1 flex-col items-center justify-center px-5">
        <button
          type="button"
          disabled={busy || (!data.settings.allowOffsite && active.length === 0)}
          onClick={() => locateFirst(primary)}
          aria-label={busy ? "Đang ghi" : primary === "in" ? "Vào ca" : "Ra ca"}
          className="punch-float disabled:opacity-40"
        >
          <span className="punch-halo" aria-hidden="true" />
          <span className="punch-invite" aria-hidden="true" />
          <span className="punch-face">
            <img src="/punch-logo-dark.png" alt="" className="punch-logo" />
          </span>
        </button>
        <p className="mt-[clamp(0.75rem,2.4dvh,1.25rem)] text-center font-display text-xl font-bold tracking-wide text-ice md:text-2xl">
          {busy ? "ĐANG GHI…" : primary === "in" ? "CHẠM ĐỂ VÀO CA" : "CHẠM ĐỂ RA CA"}
        </p>
        {active.length === 0 && !data.settings.allowOffsite ? (
          <p className="mt-2 text-center text-sm text-clay">Chưa có điểm chấm công đang bật.</p>
        ) : null}
        {result ? (
          <p className={`mt-2 max-h-16 w-full overflow-y-auto rounded-lg px-3 py-1.5 text-xs leading-5 ${result.ok ? "bg-card text-ink" : "bg-clay text-night"}`}>
            <span className="font-semibold">{result.ok ? (result.offsite ? "Đã ghi, ngoài điểm. " : "Đã ghi nhận. ") : "Ngoài vị trí cho phép. "}</span>
            {result.ok
              ? result.offsite
                ? "Quản trị và người duyệt đã được báo."
                : `Tại ${result.nearestName}, cách tâm ${formatMeters(result.distanceMeters)}.`
              : result.message}
            {result.ok && result.lateMinutes >= data.settings.lateMinutes ? ` Muộn ${result.lateMinutes} phút.` : ""}
            {result.ok && vnWeekday(result.punchedAt) === 0 && result.overtimeStatus !== "pending" ? " Chủ nhật tính tăng ca, chờ duyệt khi ra ca." : ""}
            {result.ok && result.overtimeStatus === "pending" ? ` Tăng ca ${minutesToHm(result.overtimeMinutes)}, chờ duyệt mới được tính.` : ""}
          </p>
        ) : null}
        {error ? <p className="mt-2 max-h-16 w-full overflow-y-auto text-center text-xs text-clay">{error}</p> : null}
        {geoFailed && pendingPhoto ? (
          <button type="button" className={`${secondaryBtn} mt-2 h-10 w-full`} onClick={() => locateThenSubmit(geoFailed, pendingPhoto)}>
            Thử lấy GPS lại
          </button>
        ) : null}
      </div>

      <div className="mx-5 grid shrink-0 grid-cols-2 gap-3 md:mx-8">
        <div className="rounded-xl border border-line bg-card px-4 py-2.5">
          <p className="text-xs text-muted">Giờ vào</p>
          <p className="font-display text-[1.75rem] leading-tight font-bold whitespace-nowrap tabular-nums text-ink">
            {firstIn ? vnTime(firstIn.punchedAt) : "--:--"}
          </p>
          <p className={`pz-hide-tight text-xs font-semibold ${!firstIn ? "text-muted" : inLate ? "text-clay" : "text-ok"}`}>
            {!firstIn ? "Chưa vào ca" : inLate ? `Muộn ${firstIn.lateMinutes} phút` : "Đúng giờ"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card px-4 py-2.5">
          <p className="text-xs text-muted">Đã làm hôm nay</p>
          <p className="font-display text-[1.75rem] leading-tight font-bold whitespace-nowrap tabular-nums text-ink">
            {Math.floor(worked / 60)}h {String(worked % 60).padStart(2, "0")}
          </p>
          <p
            className={`pz-hide-tight text-xs font-semibold ${worked >= data.settings.fullDayMinutes ? "text-ok" : worked >= data.settings.halfDayMinutes ? "text-ice" : "text-muted"}`}
          >
            {worked >= data.settings.fullDayMinutes ? "Đủ công" : worked >= data.settings.halfDayMinutes ? "Đủ nửa công" : "Chưa đủ công"}
          </p>
        </div>
      </div>

      <div className="mx-5 flex shrink-0 items-center gap-4 rounded-xl bg-ice px-4 py-3 text-night md:mx-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Công tháng {monthNo}</p>
          <p className="font-display text-[1.75rem] leading-tight font-bold tabular-nums">
            {congText(cong)} / {standard || "–"}
          </p>
          <div className="pz-hide-compact mt-1.5 h-1.5 overflow-hidden rounded-full bg-night/25">
            <div className="h-full rounded-full bg-night" style={{ width: `${standard ? Math.min(100, (cong / standard) * 100) : 0}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={onGoRequests}
          className="shrink-0 rounded-lg bg-night px-4 py-2.5 text-sm font-semibold text-ice"
        >
          Gửi đơn
        </button>
      </div>

      {cameraFor ? (
        <CameraSheet
          onClose={() => setCameraFor(null)}
          onShot={(photo) => {
            const type = cameraFor;
            setCameraFor(null);
            if (pendingLoc) {
              void submit(type, pendingLoc.lat, pendingLoc.lng, photo, "gps", pendingLoc.accuracy);
              setPendingLoc(null);
            } else {
              locateThenSubmit(type, photo);
            }
          }}
        />
      ) : null}
    </div>
  );
}

const AVATAR_MAX = 180_000;

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 480;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Không xử lý được ảnh"));
        return;
      }
      const scale = Math.max(size / img.width, size / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
      let quality = 0.82;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > AVATAR_MAX && quality > 0.4) {
        quality -= 0.1;
        data = canvas.toDataURL("image/jpeg", quality);
      }
      URL.revokeObjectURL(url);
      if (data.length > AVATAR_MAX) reject(new Error("Ảnh quá nặng. Chọn ảnh nhỏ hơn."));
      else resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh"));
    };
    img.src = url;
  });
}

export function ProfilePanel({
  data,
  onChanged,
}: {
  data: WorkspaceData;
  onChanged: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(data.profile.fullName);
  const [avatar, setAvatar] = useState(data.profile.avatar ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial = (name || "N").trim().charAt(0).toUpperCase();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setSaved(false);
    try {
      setAvatar(await compressAvatar(file));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile({
        data: {
          fullName: name,
          avatar: avatar && avatar !== data.profile.avatar ? avatar : "",
        },
      });
      setSaved(true);
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setName(data.profile.fullName);
    setAvatar(data.profile.avatar ?? "");
    setError("");
    setEditing(false);
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex flex-col items-center rounded-xl border border-edge bg-card px-5 py-6">
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            fileRef.current?.click();
          }}
          className="relative grid size-28 place-items-center overflow-hidden rounded-full bg-paper text-2xl font-medium ring-4 ring-ice"
          aria-label="Tải ảnh đại diện"
        >
          {avatar ? <img src={avatar} alt="" className="size-28 object-cover" /> : initial}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {editing ? (
          <button type="button" className="mt-3 text-sm font-medium text-ink" onClick={() => fileRef.current?.click()}>
            Đổi ảnh đại diện
          </button>
        ) : null}
        <p className="mt-4 text-xs font-semibold text-ice">{data.companyName}</p>
        <p className="font-display text-3xl font-bold">{name || "Nhân viên"}</p>
        <span className="mt-1 rounded-full bg-sand px-3 py-0.5 text-xs font-semibold text-muted">{ROLE_LABEL[data.profile.role]}</span>
      </div>

      <div className="rounded-xl border border-edge bg-card p-4">
        {editing ? (
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              Họ tên
              <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
            </label>
            <p className="text-xs text-muted">Bạn chỉ tự sửa được họ tên và ảnh đại diện. Các thông tin còn lại do quản trị cập nhật.</p>
            {error ? <p className="text-sm text-clay">{error}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <button className={secondaryBtn} type="button" onClick={cancelEdit} disabled={busy}>
                Hủy
              </button>
              <button className={primaryBtn} type="submit" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu hồ sơ"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <dl className="divide-y divide-line text-sm">
              {(
                [
                  ["Họ tên", data.profile.fullName],
                  ["Số đăng nhập", data.profile.phone ? displayPhone(data.profile.phone) : "Chưa gắn"],
                  ["Mã nhân viên", data.profile.employeeCode],
                  ["Phòng ban", data.profile.department],
                  ["Chức danh", data.profile.jobTitle],
                  ["Ngày vào làm", data.profile.startedOn ? data.profile.startedOn.split("-").reverse().join("/") : null],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className={`min-w-0 truncate text-right font-medium ${value ? "" : "text-muted"}`}>{value || "Chưa cập nhật"}</dd>
                </div>
              ))}
            </dl>
            {saved ? <p className="mt-2 text-sm text-ok">Đã lưu hồ sơ.</p> : null}
            <button
              className={`${secondaryBtn} mt-3 w-full`}
              type="button"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              Sửa họ tên và ảnh
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function PunchLine({ row, settings }: { row: PunchRow; settings: Settings }) {
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <article className="rounded-md border border-line border-l-4 border-l-ink bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-3xl leading-none font-semibold tabular-nums">{vnTime(row.punchedAt)}</p>
          <p className="text-sm text-muted">
            {row.nearestName ?? "Không rõ điểm"}
            {row.distanceMeters != null ? ` · ${formatMeters(row.distanceMeters)}` : ""}
            {row.offsite ? " · Ngoài điểm" : ""}
            {row.lateMinutes >= settings.lateMinutes ? ` · Muộn ${row.lateMinutes} phút` : ""}
            {row.overtimeStatus === "pending" ? ` · Tăng ca ${minutesToHm(row.overtimeMinutes)} chờ duyệt` : ""}
            {row.overtimeStatus === "approved" ? ` · Tăng ca ${minutesToHm(row.overtimeMinutes)} đã tính` : ""}
            {row.overtimeStatus === "rejected" ? " · Tăng ca không được tính" : ""}
            {row.locationSource === "manual" ? " · vị trí thủ công" : ""}
          </p>
        </div>
        <Badge tone={toneFor(row, settings)}>{punchLabel(row, settings)}</Badge>
      </div>
      {row.hasPhoto ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-ink"
          onClick={() => {
            void getPunchPhoto({ data: row.id }).then((res) => setPhoto(res.photo)).catch(() => setPhoto(null));
          }}
        >
          Xem ảnh
        </button>
      ) : null}
      {photo ? <img src={photo} alt="Ảnh chấm công" className="mt-3 max-h-64 w-full rounded-md object-cover" /> : null}
    </article>
  );
}

export function HistoryPanel({ settings }: { settings: Settings }) {
  const [month, setMonth] = useState(vnMonthKey());
  const [rows, setRows] = useState<PunchRow[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<MySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getMySummary({ data: month })
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setPicked(null);
    listHistory({ data: month })
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const grouped = new Map<string, PunchRow[]>();
  for (const row of rows ?? []) {
    const key = vnDateKey(row.punchedAt);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const stats = summarizeMonth(grouped, settings);
  const visible = picked ? [...grouped.entries()].filter(([day]) => day === picked) : [...grouped.entries()];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line bg-card" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Tháng trước">
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="font-display text-2xl font-semibold">{formatMonthLabel(month)}</h2>
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line bg-card" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Tháng sau">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="rounded-xl bg-ice px-4 py-3.5 text-night">
        <p className="text-xs font-medium">Công {formatMonthLabel(month)}</p>
        <p className="font-display text-3xl leading-tight font-bold tabular-nums">
          {summary ? `${congText(summary.cong)} / ${summary.standardDays}` : "…"}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-night/25">
          <div className="h-full rounded-full bg-night" style={{ width: `${summary ? Math.min(100, (summary.cong / Math.max(1, summary.standardDays)) * 100) : 0}%` }} />
        </div>
        <p className="mt-1.5 text-[0.7rem]">Chủ nhật và lễ chỉ tính khi tăng ca được duyệt, nhân hệ số của công ty.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Ngày có mặt" value={String(stats.days)} />
        <Stat label="Vào muộn" value={String(stats.late)} />
        <Stat label="Ra sớm" value={String(stats.early)} />
        <Stat label="Thiếu giờ ra" value={String(stats.missingOut)} />
      </div>
      <MonthGrid month={month} days={stats.marks} picked={picked} onPick={(day) => setPicked((current) => (current === day ? null : day))} />
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {rows == null ? <p className="text-sm text-muted">Đang tải lịch sử…</p> : null}
      {rows && rows.length === 0 ? <p className="rounded-md border border-dashed border-line bg-card p-4 text-sm text-muted">Tháng này chưa có lần chấm nào.</p> : null}
      {picked && visible.length === 0 ? <p className="text-sm text-muted">Ngày này chưa có lần chấm.</p> : null}
      {visible.map(([day, items]) => {
        const story = dayStory(items, settings);
        return (
          <section key={day} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted">{formatVnDay(day)}</h3>
            <div className="grid grid-cols-2 gap-2">
              <p className={`rounded-md bg-card px-3 py-3 text-sm font-medium ${story.onTime ? "text-ink" : "text-clay"}`}>
                {story.late}
              </p>
              <p className="rounded-md bg-card px-3 py-3 text-sm font-medium text-ink">{story.overtime}</p>
            </div>
            {items.map((row) => (
              <PunchLine key={row.id} row={row} settings={settings} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function dayStory(items: PunchRow[], settings: Settings): { late: string; overtime: string; onTime: boolean } {
  const sorted = [...items].sort((a, b) => a.punchedAt.localeCompare(b.punchedAt));
  const firstIn = sorted.find((row) => row.type === "in");
  const lastOut = [...sorted].reverse().find((row) => row.type === "out");
  const late = !firstIn ? "Chưa vào ca" : isLate(firstIn.lateMinutes, settings.lateMinutes) ? `Muộn ${firstIn.lateMinutes} phút` : "Đúng giờ";
  if (!lastOut) return { late, overtime: "Chưa ra ca", onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
  if (lastOut.overtimeMinutes <= 0) return { late, overtime: "Không tăng ca", onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
  const hours = minutesToHm(lastOut.overtimeMinutes);
  if (lastOut.overtimeStatus === "approved") return { late, overtime: `Tăng ca ${hours} · đã tính`, onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
  if (lastOut.overtimeStatus === "pending") return { late, overtime: `Tăng ca ${hours} · chờ duyệt`, onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
  if (lastOut.overtimeStatus === "rejected") return { late, overtime: `Tăng ca ${hours} · không tính`, onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
  return { late, overtime: `Tăng ca ${hours} · chưa đủ ${settings.overtimeMinMinutes} phút, không tính`, onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3.5 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

type DayMark = "none" | "ok" | "late" | "open" | "off";

function summarizeMonth(grouped: Map<string, PunchRow[]>, settings: Settings) {
  let days = 0;
  let late = 0;
  let early = 0;
  let missingOut = 0;
  const marks = new Map<string, DayMark>();
  const today = vnDateKey();
  for (const [day, items] of grouped) {
    const sorted = [...items].sort((a, b) => a.punchedAt.localeCompare(b.punchedAt));
    const firstIn = sorted.find((row) => row.type === "in");
    const lastOut = [...sorted].reverse().find((row) => row.type === "out");
    if (!firstIn) continue;
    days += 1;
    const wasLate = isLate(firstIn.lateMinutes, settings.lateMinutes);
    if (wasLate) late += 1;
    if (lastOut && vnWeekday(lastOut.punchedAt) !== 0 && isEarlyOut(lastOut.punchedAt, settings.workEnd)) early += 1;
    const stillOpen = !lastOut || sorted[sorted.length - 1]?.type === "in";
    if (stillOpen && day < today) missingOut += 1;
    const mark: DayMark = firstIn.offsite
      ? "off"
      : stillOpen && day === today
        ? "open"
        : wasLate
          ? "late"
          : "ok";
    marks.set(day, mark);
  }
  return { days, late, early, missingOut, marks };
}

function MonthGrid({
  month,
  days,
  picked,
  onPick,
}: {
  month: string;
  days: Map<string, DayMark>;
  picked: string | null;
  onPick: (day: string) => void;
}) {
  const count = daysInMonth(month);
  const lead = mondayIndex(`${month}-01`);
  const cells: Array<string | null> = [...Array(lead).fill(null)];
  for (let day = 1; day <= count; day += 1) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="grid grid-cols-7 text-center text-xs text-muted">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((label) => (
          <span key={label} className="py-1">{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, index) =>
          day ? (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              className={`relative grid h-11 place-items-center rounded-lg text-sm tabular-nums ${
                picked === day ? "bg-pine text-card" : markClass(days.get(day) ?? "none")
              }`}
            >
              {Number(day.slice(8))}
              {days.get(day) && days.get(day) !== "none" ? (
                <span
                  className={`absolute bottom-1 size-1.5 rounded-full ${
                    picked === day ? "bg-card" : days.get(day) === "ok" ? "bg-ok" : days.get(day) === "open" ? "bg-ice" : "bg-clay"
                  }`}
                />
              ) : null}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}

function markClass(mark: DayMark): string {
  if (mark === "ok") return "font-semibold text-ink";
  if (mark === "late" || mark === "off") return "font-semibold text-clay";
  if (mark === "open") return "font-semibold text-ink";
  return "text-muted";
}

export function RequestsPanel({
  canReview,
  maxCorrections,
  userId,
  workStart,
  workEnd,
  onChanged,
}: {
  canReview: boolean;
  maxCorrections: number;
  userId: string;
  workStart: string;
  workEnd: string;
  onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<"review" | "fix" | "leave" | "mine">("fix");
  const [rows, setRows] = useState<CorrectionRow[] | null>(null);
  const [error, setError] = useState("");
  const [date, setDate] = useState(vnDateKey());
  const [punchType, setPunchType] = useState<"in" | "out">("in");
  const [requestedTime, setRequestedTime] = useState(workStart);
  const [kind, setKind] = useState("quen");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  async function load() {
    const next = await listCorrections();
    setRows(next);
  }

  useEffect(() => {
    let cancelled = false;
    listCorrections()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createCorrection({ data: { attendanceDate: date, punchType, requestedTime, kind, note } });
      setNote("");
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: number, decision: "approved" | "rejected") {
    setError("");
    try {
      await reviewCorrection({ data: { id, decision, reviewNote: reviewNotes[id] ?? "" } });
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const pending = (rows ?? []).filter((row) => row.status === "pending");
  const used = (rows ?? []).filter(
    (row) => row.userId === userId && row.status !== "rejected" && vnMonthKey(row.createdAt) === vnMonthKey(),
  ).length;
  const archive = (rows ?? []).filter((row) => !canReview || row.status !== "pending");

  const tabs: { id: typeof view; label: string; badge?: number }[] = [
    ...(canReview ? [{ id: "review" as const, label: "Chờ duyệt", badge: pending.length }] : []),
    { id: "fix", label: "Sửa công" },
    { id: "leave", label: "Xin nghỉ" },
    { id: "mine", label: canReview ? "Tất cả" : "Đã gửi" },
  ];
  const tab = tabs.some((t) => t.id === view) ? view : "fix";

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-line bg-card p-1" role="tablist" aria-label="Loại đơn">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setView(t.id)}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${tab === t.id ? "bg-ice text-night" : "text-muted"}`}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 rounded-full bg-clay px-1.5 text-xs text-night">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {canReview && tab === "review" ? (
        <section className="space-y-2">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-semibold">Đơn chờ duyệt</h2>
            <p className="text-sm font-semibold tabular-nums text-clay">{pending.length}</p>
          </div>
          {pending.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-card p-4 text-sm text-muted">Không có đơn chờ.</p>
          ) : null}
          {pending.map((row) => (
            <article key={row.id} className="space-y-3 rounded-md border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.fullName}</p>
                  <p className="text-sm text-muted">{formatVnDay(row.attendanceDate)}</p>
                </div>
                <span className="rounded-full bg-sand px-2 py-1 text-xs font-semibold">
                  {row.punchType === "in" ? "Vào" : "Ra"} {row.requestedTime}
                </span>
              </div>
              <p className="text-sm">
                <span className="font-medium">{KIND_LABEL[row.kind] ?? row.kind}.</span> {row.note}
              </p>
              <input
                className={fieldClass}
                placeholder="Ghi chú khi duyệt, nếu cần"
                value={reviewNotes[row.id] ?? ""}
                onChange={(e) => setReviewNotes((current) => ({ ...current, [row.id]: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={primaryBtn} onClick={() => void review(row.id, "approved")}>Duyệt</button>
                <button type="button" className={secondaryBtn} onClick={() => void review(row.id, "rejected")}>Từ chối</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "fix" ? (
      <form className="space-y-3 rounded-xl border border-line bg-card p-4" onSubmit={submit}>
        <h2 className="font-display text-2xl font-bold">Gửi đơn sửa công</h2>
        <p className="text-sm text-muted">
          Tháng này đã dùng {used}/{maxCorrections} đơn không bị từ chối. Người phụ trách sẽ duyệt.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            Ngày
            <input className={fieldClass} type="date" value={date} max={vnDateKey()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="space-y-1 text-sm">
            Giờ cần ghi
            <input className={fieldClass} type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} required />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            Loại
            <select className={fieldClass} value={punchType} onChange={(e) => {
                const next = e.target.value as "in" | "out";
                setPunchType(next);
                setRequestedTime(next === "in" ? workStart : workEnd);
              }}>
              <option value="in">Vào ca</option>
              <option value="out">Ra ca</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Lý do
            <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="quen">Quên chấm</option>
              <option value="gps">GPS lỗi</option>
              <option value="congtac">Công tác ngoài</option>
              <option value="khac">Khác</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          Ghi chú
          <textarea className="min-h-24 w-full rounded-md border border-line bg-card px-3 py-2 text-base outline-none focus:border-ink" value={note} onChange={(e) => setNote(e.target.value)} required minLength={4} />
        </label>
        <button className={`${primaryBtn} w-full`} type="submit" disabled={busy}>{busy ? "Đang gửi…" : "Gửi đơn"}</button>
      </form>
      ) : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {tab === "leave" ? <LeaveSection canReview={canReview} userId={userId} onChanged={onChanged} /> : null}
      {tab === "mine" ? (
      <section className="space-y-2">
        <h3 className="font-semibold">{canReview ? "Tất cả đơn" : "Đơn của tôi"}</h3>
        {rows == null ? <p className="text-sm text-muted">Đang tải đơn…</p> : null}
        {rows && archive.length === 0 ? <p className="text-sm text-muted">Chưa có đơn nào.</p> : null}
        {archive.map((row) => (
          <article key={`all-${row.id}`} className="rounded-xl border border-line bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{row.fullName}</p>
              <Badge tone={row.status === "approved" ? "ok" : row.status === "rejected" ? "late" : "muted"}>
                {row.status === "approved" ? "Đã duyệt" : row.status === "rejected" ? "Từ chối" : "Chờ duyệt"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {formatVnDay(row.attendanceDate)} · {row.punchType === "in" ? "Vào" : "Ra"} {row.requestedTime} · {KIND_LABEL[row.kind] ?? row.kind}
            </p>
            <p className="mt-1 text-sm">{row.note}</p>
            {row.reviewNote ? <p className="mt-1 text-sm text-muted">Ghi chú duyệt: {row.reviewNote}</p> : null}
          </article>
        ))}
      </section>
      ) : null}
    </div>
  );
}

const LEAVE_KIND_LABEL: Record<string, string> = {
  phep: "Nghỉ phép",
  om: "Nghỉ ốm",
  thaisan: "Thai sản",
  khac: "Nghỉ khác",
};

function LeaveSection({ canReview, userId, onChanged }: { canReview: boolean; userId: string; onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [error, setError] = useState("");
  const [date, setDate] = useState(vnDateKey());
  const [kind, setKind] = useState("phep");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  async function load() {
    setRows(await listLeaves());
  }
  useEffect(() => {
    let cancelled = false;
    listLeaves()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createLeaveRequest({ data: { leaveDate: date, kind, note } });
      setNote("");
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: number, decision: "approved" | "rejected") {
    setError("");
    try {
      await reviewLeave({ data: { id, decision, reviewNote: reviewNotes[id] ?? "" } });
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const pending = (rows ?? []).filter((row) => row.status === "pending" && row.userId !== userId);
  const mine = (rows ?? []).filter((row) => row.userId === userId);

  return (
    <div className="space-y-4">
      {canReview && pending.length ? (
        <section className="space-y-2">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-semibold">Đơn nghỉ chờ duyệt</h2>
            <p className="text-sm font-semibold tabular-nums text-clay">{pending.length}</p>
          </div>
          {pending.map((row) => (
            <article key={row.id} className="space-y-3 rounded-md border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.fullName}</p>
                  <p className="text-sm text-muted">{formatVnDay(row.leaveDate)}</p>
                </div>
                <span className="rounded-full bg-sand px-2 py-1 text-xs font-semibold">{LEAVE_KIND_LABEL[row.kind] ?? row.kind}</span>
              </div>
              <p className="text-sm">{row.note}</p>
              <input
                className={fieldClass}
                placeholder="Ghi chú khi duyệt, nếu cần"
                value={reviewNotes[row.id] ?? ""}
                onChange={(e) => setReviewNotes((current) => ({ ...current, [row.id]: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={primaryBtn} onClick={() => void review(row.id, "approved")}>Duyệt</button>
                <button type="button" className={secondaryBtn} onClick={() => void review(row.id, "rejected")}>Từ chối</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      <form className="space-y-3" onSubmit={submit}>
        <h2 className="font-display text-2xl font-semibold">Xin nghỉ</h2>
        <p className="text-sm text-muted">Mỗi đơn là một ngày. Được duyệt thì ngày đó không bị tính vắng.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            Ngày nghỉ
            <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="space-y-1 text-sm">
            Loại nghỉ
            <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="phep">Nghỉ phép</option>
              <option value="om">Nghỉ ốm</option>
              <option value="thaisan">Thai sản</option>
              <option value="khac">Khác</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          Lý do
          <textarea className="min-h-20 w-full rounded-md border border-line bg-card px-3 py-2 text-base outline-none focus:border-ink" value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={300} />
        </label>
        <button className={primaryBtn} type="submit" disabled={busy}>{busy ? "Đang gửi…" : "Gửi đơn nghỉ"}</button>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
      </form>
      {mine.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold">Đơn nghỉ của tôi</h3>
          {mine.map((row) => (
            <article key={`mine-${row.id}`} className="rounded-md border border-line bg-card px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{formatVnDay(row.leaveDate)} · {LEAVE_KIND_LABEL[row.kind] ?? row.kind}</p>
                <Badge tone={row.status === "approved" ? "ok" : row.status === "rejected" ? "late" : "muted"}>
                  {row.status === "approved" ? "Đã duyệt" : row.status === "rejected" ? "Từ chối" : "Chờ duyệt"}
                </Badge>
              </div>
              <p className="mt-1 text-sm">{row.note}</p>
              {row.reviewNote ? <p className="mt-1 text-sm text-muted">Ghi chú duyệt: {row.reviewNote}</p> : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function RankPanel() {
  const [month, setMonth] = useState(vnMonthKey());
  const [data, setData] = useState<RankLists | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    listRankings({ data: month })
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, [month]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line bg-card" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Tháng trước">
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="font-display text-2xl font-semibold">{formatMonthLabel(month)}</h2>
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line bg-card" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Tháng sau">
          <ChevronRight className="size-5" />
        </button>
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">Đang tính bảng xếp hạng…</p> : null}
      {data && !data.enabled ? (
        <p className="rounded-md border border-dashed border-line bg-card p-4 text-sm text-muted">Bảng xếp hạng đang tắt. Quản trị bật trong phần cài đặt nếu muốn dùng.</p>
      ) : null}
      {data?.enabled ? (
        <>
          <RankList title="Đi đều nhất" empty="Chưa đủ dữ liệu vào ca." rows={data.consistent.map((row, index) => ({ id: `${index}-${row.fullName}`, line: `${row.fullName} · ${row.onTime}/${row.days} ngày đúng giờ` }))} />
          <RankList title="Vào sớm nhất" empty="Chưa có giờ vào trong tháng." rows={data.earliest.map((row, index) => ({ id: `${index}-${row.fullName}`, line: `${row.fullName} · trung bình ${minutesToHm(row.avgMinutes)}` }))} />
        </>
      ) : null}
    </div>
  );
}

function RankList({ title, rows, empty }: { title: string; rows: { id: string; line: string }[]; empty: string }) {
  return (
    <section className="rounded-md border border-line bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">{empty}</p> : null}
      <ol className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <li key={row.id} className="flex gap-3 text-sm">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sand font-semibold tabular-nums">{index + 1}</span>
            <span className="pt-1">{row.line}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

type ManageTab = "today" | "people" | "more";
type Roster = "in" | "out" | "missing" | "late";

const SHOW_STEP = 5;

export function ManagePanel({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const isAdmin = data.profile.role === "admin";
  const [tab, setTab] = useState<ManageTab>("today");
  const todo = data.overtimePending.length + data.offsiteToday.length + data.pendingCount;
  const tabs: { key: ManageTab; label: string; badge?: number }[] = [
    { key: "today", label: "Hôm nay", badge: todo },
    { key: "people", label: "Nhân sự" },
    { key: "more", label: isAdmin ? "Cài đặt" : "Bảng công" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-edge bg-card p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`relative h-11 rounded-lg text-sm font-semibold transition-colors ${tab === t.key ? "bg-ink text-card" : "text-muted"}`}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-clay px-1.5 text-xs text-white">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "today" ? <TodayTab data={data} onChanged={onChanged} /> : null}
      {tab === "people" ? <PeopleTab data={data} onChanged={onChanged} /> : null}
      {tab === "more" ? <MoreTab data={data} onChanged={onChanged} isAdmin={isAdmin} /> : null}
    </div>
  );
}

function TodayTab({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const people = data.teamToday.filter((p) => p.isActive !== false);
  const lateIds = new Set(data.lateToday.map((row) => row.userId).filter((id): id is string => Boolean(id)));
  const [roster, setRoster] = useState<Roster>("missing");
  const [more, setMore] = useState(SHOW_STEP);
  const groups: Record<Roster, PersonRow[]> = {
    in: people.filter((p) => p.lastType === "in"),
    out: people.filter((p) => p.lastType === "out"),
    missing: people.filter((p) => !p.lastAt),
    late: people.filter((p) => lateIds.has(p.userId)),
  };
  const chips: { key: Roster; label: string; tone: string }[] = [
    { key: "in", label: "Trong ca", tone: "text-ink" },
    { key: "out", label: "Đã ra", tone: "text-ok" },
    { key: "missing", label: "Chưa chấm", tone: groups.missing.length ? "text-clay" : "text-muted" },
    { key: "late", label: "Đi muộn", tone: groups.late.length ? "text-clay" : "text-muted" },
  ];
  const list = groups[roster];
  const shown = list.slice(0, more);
  return (
    <div className="space-y-4">
      <ApprovalCard data={data} onChanged={onChanged} />
      <section className="rounded-xl border border-edge bg-card p-3">
        <div className="grid grid-cols-4 gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={roster === c.key}
              onClick={() => {
                setRoster(c.key);
                setMore(SHOW_STEP);
              }}
              className={`rounded-lg border px-1 py-2 text-center ${roster === c.key ? "border-ink bg-ink/10" : "border-line"}`}
            >
              <span className={`block font-display text-3xl leading-none font-semibold tabular-nums ${c.tone}`}>{groups[c.key].length}</span>
              <span className="mt-1 block text-xs text-muted">{c.label}</span>
            </button>
          ))}
        </div>
        <ul className="mt-3 divide-y divide-line">
          {list.length === 0 ? (
            <li className="py-3 text-sm text-muted">{roster === "missing" ? "Mọi người đã chấm công." : "Chưa có ai."}</li>
          ) : null}
          {shown.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 py-2.5">
              <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${lateIds.has(p.userId) ? "bg-clay/10 text-clay" : "bg-sand text-ink"}`}>
                {initials(p.fullName)}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.fullName}</p>
              <p className={`text-sm font-semibold tabular-nums ${lateIds.has(p.userId) ? "text-clay" : "text-muted"}`}>
                {p.firstInAt ? vnTime(p.firstInAt) : p.lastAt ? vnTime(p.lastAt) : "—"}
                {lateIds.has(p.userId) && p.firstInLate ? ` · +${p.firstInLate}p` : ""}
              </p>
            </li>
          ))}
        </ul>
        {list.length > shown.length ? (
          <button type="button" className="mt-1 h-10 w-full rounded-lg text-sm font-semibold text-ink" onClick={() => setMore((n) => n + SHOW_STEP * 2)}>
            Xem thêm {list.length - shown.length} người
          </button>
        ) : null}
        {more > SHOW_STEP && list.length <= shown.length && list.length > SHOW_STEP ? (
          <button type="button" className="mt-1 h-10 w-full rounded-lg text-sm font-semibold text-muted" onClick={() => setMore(SHOW_STEP)}>
            Thu gọn
          </button>
        ) : null}
      </section>
    </div>
  );
}

/** Mọi việc cần người quản lý bấm: tăng ca chờ duyệt và chấm ngoài điểm. Hiện tối đa vài dòng, không có thì ẩn cả thẻ. */
function ApprovalCard({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [photoFor, setPhotoFor] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const ot = data.overtimePending;
  const off = data.offsiteToday;
  const shownOt = all ? ot : ot.slice(0, 3);
  const total = ot.length + off.length;

  async function decide(id: number, decision: "approved" | "rejected") {
    setError("");
    try {
      await reviewOvertime({ data: { id, decision } });
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (total === 0) {
    return (
      <section className="rounded-xl border border-edge bg-card px-4 py-3 text-sm text-muted">
        Không có gì cần duyệt. Tăng ca từ {data.settings.overtimeMinMinutes} phút sẽ hiện ở đây.
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-gold/50 bg-card p-3">
      <h3 className="px-1 font-display text-2xl font-semibold">Cần xử lý · {total}</h3>
      {error ? <p className="px-1 text-sm text-clay">{error}</p> : null}
      {ot.length ? <p className="mt-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase">Tăng ca chờ duyệt</p> : null}
      <ul className="divide-y divide-line">
        {shownOt.map((row) => (
          <li key={row.id} className="py-2.5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand text-xs font-semibold">{initials(row.fullName ?? "?")}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.fullName ?? "Nhân viên"}</p>
                <p className="text-xs text-muted">Ra lúc {vnTime(row.punchedAt)}</p>
              </div>
              <p className="font-display text-xl font-semibold tabular-nums">{minutesToHm(row.overtimeMinutes)}</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={`${primaryBtn} !h-10`} onClick={() => void decide(row.id, "approved")}>
                Chấp nhận
              </button>
              <button type="button" className={`${secondaryBtn} !h-10`} onClick={() => void decide(row.id, "rejected")}>
                Từ chối
              </button>
            </div>
          </li>
        ))}
      </ul>
      {ot.length > 3 ? (
        <button type="button" className="h-10 w-full text-sm font-semibold text-ink" onClick={() => setAll((v) => !v)}>
          {all ? "Thu gọn" : `Xem thêm ${ot.length - 3} tăng ca`}
        </button>
      ) : null}
      {off.length ? <p className="mt-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase">Chấm ngoài điểm</p> : null}
      <ul className="divide-y divide-line">
        {off.map((row) => (
          <li key={row.id} className="py-2.5">
            <p className="text-sm font-medium">{row.fullName ?? "Nhân viên"}</p>
            <p className="text-xs text-muted">
              {vnTime(row.punchedAt)} · {row.type === "in" ? "Vào" : "Ra"}
              {row.nearestName ? ` · gần ${row.nearestName}` : ""}
              {row.distanceMeters != null ? ` · ${formatMeters(row.distanceMeters)}` : ""}
            </p>
            {row.hasPhoto ? (
              <button
                type="button"
                className="mt-1 text-sm font-semibold text-ink"
                onClick={() => {
                  if (photoFor === row.id) {
                    setPhotoFor(null);
                    return;
                  }
                  setPhotoFor(row.id);
                  setPhoto(null);
                  void getPunchPhoto({ data: row.id }).then((res) => setPhoto(res.photo)).catch(() => setPhoto(null));
                }}
              >
                {photoFor === row.id ? "Ẩn ảnh" : "Xem ảnh"}
              </button>
            ) : null}
            {photoFor === row.id && photo ? <img src={photo} alt="Ảnh chấm công" className="mt-2 max-h-56 w-full rounded-lg object-cover" /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeopleTab({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [more, setMore] = useState(8);
  const q = query.trim().toLowerCase();
  const list = [...data.teamToday].sort(compareByCode).filter(
    (p) => p.isActive !== false && (!q || [p.fullName, p.employeeCode ?? "", p.phone ?? "", p.department ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const shown = list.slice(0, more);
  const open = openId ? data.teamToday.find((p) => p.userId === openId) : undefined;
  return (
    <section className="space-y-3">
      <input
        className={fieldClass}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMore(8);
        }}
        placeholder={`Tìm trong ${data.teamToday.filter((p) => p.isActive !== false).length} người…`}
        aria-label="Tìm nhân viên"
      />
      {open ? (
        <div className="space-y-2">
          <button type="button" className="flex h-10 items-center gap-1 text-sm font-semibold text-ink" onClick={() => setOpenId(null)}>
            <ChevronLeft className="size-4" /> Danh sách
          </button>
          <PersonCard key={open.userId} person={open} selfId={data.profile.userId} onChanged={onChanged} />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-xl border border-edge bg-card">
            {list.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Không tìm thấy ai.</li> : null}
            {shown.map((p) => (
              <li key={p.userId}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpenId(p.userId)}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand text-xs font-semibold">{initials(p.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.fullName}{p.userId === data.profile.userId ? " (bạn)" : ""}</span>
                    <span className="block truncate text-xs text-muted">{[ROLE_LABEL[p.role], p.department].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
          {list.length > shown.length ? (
            <button type="button" className={`${secondaryBtn} w-full`} onClick={() => setMore((n) => n + 10)}>
              Xem thêm {list.length - shown.length} người
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-edge bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
        </span>
        <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 border-t border-line p-3">{children}</div>
    </details>
  );
}

function MoreTab({ data, onChanged, isAdmin }: { data: WorkspaceData; onChanged: () => Promise<void>; isAdmin: boolean }) {
  return (
    <div className="space-y-2">
      <Fold title="Xuất bảng công" hint="Tải file theo tháng">
        <TimesheetExport />
      </Fold>
      {isAdmin ? (
        <>
          <Fold title="Mã mời nhân viên" hint="Gửi mã cho người mới đăng ký">
            <InviteCodeCard />
          </Fold>
          <Fold title="Giờ và quy tắc" hint={`${data.settings.workStart}–${data.settings.workEnd} · tăng ca từ ${data.settings.overtimeMinMinutes} phút`}>
            <SettingsForm data={data} onChanged={onChanged} />
          </Fold>
          <Fold title="Điểm chấm công" hint={`${data.locations.length} địa điểm`}>
            <LocationEditor locations={data.locations} onChanged={onChanged} />
          </Fold>
        </>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function TimesheetExport() {
  const [month, setMonth] = useState(vnMonthKey());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setError("");
    try {
      const file = await exportTimesheet({ data: month });
      const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Tháng trước">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-medium">{formatMonthLabel(month)}</p>
        <button type="button" className="grid size-11 place-items-center rounded-full border border-line" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Tháng sau">
          <ChevronRight className="size-5" />
        </button>
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <button type="button" className={`${primaryBtn} w-full`} disabled={busy} onClick={() => void download()}>
        {busy ? "Đang tạo…" : "Tải bảng công"}
      </button>
    </section>
  );
}

export function SettingsForm({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(data.companyName);
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    try {
      await saveCompany({ data: { name, settings } });
      setSaved(true);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label className="block space-y-1 text-sm">
        Tên công ty
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          Giờ vào
          <input className={fieldClass} type="time" value={settings.workStart} onChange={(e) => setSettings({ ...settings, workStart: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          Giờ ra
          <input className={fieldClass} type="time" value={settings.workEnd} onChange={(e) => setSettings({ ...settings, workEnd: e.target.value })} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          Nghỉ trưa từ
          <input className={fieldClass} type="time" value={settings.lunchStart} onChange={(e) => setSettings({ ...settings, lunchStart: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          Nghỉ trưa đến
          <input className={fieldClass} type="time" value={settings.lunchEnd} onChange={(e) => setSettings({ ...settings, lunchEnd: e.target.value })} />
        </label>
      </div>
      <p className="text-xs text-muted">Nhân viên chỉ chấm 2 lần: vào đầu ca và ra cuối ca. Giờ làm = từ giờ vào đến giờ ra, trừ nghỉ trưa (ca 07:30–17:30 nghỉ 11:30–13:30 là 8 giờ).</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="space-y-1 text-sm">
          Tăng ca tính từ (phút)
          <input className={fieldClass} type="number" min={0} max={240} value={settings.overtimeMinMinutes} onChange={(e) => setSettings({ ...settings, overtimeMinMinutes: Number(e.target.value) })} />
        </label>
        <label className="space-y-1 text-sm">
          Báo muộn từ (phút)
          <input className={fieldClass} type="number" min={0} max={180} value={settings.lateMinutes} onChange={(e) => setSettings({ ...settings, lateMinutes: Number(e.target.value) })} />
        </label>
        <label className="space-y-1 text-sm">
          Đơn sửa / tháng
          <input className={fieldClass} type="number" min={0} max={20} value={settings.maxCorrections} onChange={(e) => setSettings({ ...settings, maxCorrections: Number(e.target.value) })} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          Đủ 1 công từ (giờ làm)
          <input className={fieldClass} type="number" min={1} max={16} step={0.5} value={settings.fullDayMinutes / 60} onChange={(e) => setSettings({ ...settings, fullDayMinutes: Math.round(Number(e.target.value) * 60) })} />
        </label>
        <label className="space-y-1 text-sm">
          Được 0.5 công từ (giờ làm)
          <input className={fieldClass} type="number" min={0.5} max={16} step={0.5} value={settings.halfDayMinutes / 60} onChange={(e) => setSettings({ ...settings, halfDayMinutes: Math.round(Number(e.target.value) * 60) })} />
        </label>
      </div>
      <p className="text-xs text-muted">Giờ làm là tổng các đoạn vào–ra trong ngày. Dưới mức nửa công thì tính 0.</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="space-y-1 text-sm">
          Công chuẩn / tháng
          <input className={fieldClass} type="number" min={20} max={31} value={settings.standardDays} onChange={(e) => setSettings({ ...settings, standardDays: Number(e.target.value) })} />
        </label>
        <label className="space-y-1 text-sm">
          Hệ số Chủ nhật
          <input className={fieldClass} type="number" min={1} max={5} step={0.1} value={settings.sundayRate} onChange={(e) => setSettings({ ...settings, sundayRate: Number(e.target.value) })} />
        </label>
        <label className="space-y-1 text-sm">
          Hệ số ngày lễ
          <input className={fieldClass} type="number" min={1} max={5} step={0.1} value={settings.holidayRate} onChange={(e) => setSettings({ ...settings, holidayRate: Number(e.target.value) })} />
        </label>
      </div>
      <p className="text-xs text-muted">Công chuẩn tính theo tháng trừ Chủ nhật (mặc định 26). Làm Chủ nhật hoặc lễ phải được duyệt tăng ca, rồi nhân hệ số. Nghỉ lễ ngày thường vẫn tính 1 công.</p>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={settings.rankingsEnabled} onChange={(e) => setSettings({ ...settings, rankingsEnabled: e.target.checked })} />
        Bật bảng xếp hạng tháng
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={settings.requirePhoto} onChange={(e) => setSettings({ ...settings, requirePhoto: e.target.checked })} />
        Bắt buộc chụp ảnh khi chấm
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.allowOffsite}
          onChange={(e) => setSettings({ ...settings, allowOffsite: e.target.checked })}
        />
        Cho phép chấm ngoài điểm
      </label>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {saved ? <p className="text-sm text-ok">Đã lưu cài đặt.</p> : null}
      <button className={primaryBtn} type="submit">Lưu cài đặt</button>
    </form>
  );
}

export function LocationEditor({ locations, onChanged }: { locations: LocationRow[]; onChanged: () => Promise<void> }) {
  const blank = { id: null as number | null, name: "", lat: "", lng: "", radiusMeters: "150", isActive: true };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await saveLocation({
        data: {
          id: form.id,
          name: form.name,
          lat: Number(form.lat),
          lng: Number(form.lng),
          radiusMeters: Number(form.radiusMeters),
          isActive: form.isActive,
        },
      });
      setForm(blank);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  function useGps() {
    if (!navigator.geolocation) {
      setError("Máy không có GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((current) => ({
          ...current,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
      },
      () => setError("Chưa lấy được GPS để điền tọa độ."),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-bold">Điểm chấm công</h2>
      {locations.map((loc) => (
        <article key={loc.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-card px-4 py-3">
          <div>
            <p className="font-medium">{loc.name}</p>
            <p className="text-sm text-muted">
              {loc.isActive ? "Đang bật" : "Đang tắt"} · {loc.radiusMeters} m
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-ink"
            onClick={() =>
              setForm({
                id: loc.id,
                name: loc.name,
                lat: String(loc.lat),
                lng: String(loc.lng),
                radiusMeters: String(loc.radiusMeters),
                isActive: loc.isActive,
              })
            }
          >
            Sửa
          </button>
        </article>
      ))}
      <form className="space-y-3" onSubmit={submit}>
        <h3 className="font-display text-xl font-bold">{form.id ? "Sửa điểm" : "Thêm điểm"}</h3>
        <input className={fieldClass} placeholder="Tên điểm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="grid grid-cols-2 gap-3">
          <input className={fieldClass} placeholder="Vĩ độ" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} required />
          <input className={fieldClass} placeholder="Kinh độ" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} required />
        </div>
        <input className={fieldClass} type="number" min={30} max={2000} value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} />
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Đang bật
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={secondaryBtn} onClick={useGps}>Lấy GPS máy</button>
          <button className={primaryBtn} type="submit">{form.id ? "Cập nhật" : "Thêm"}</button>
        </div>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
      </form>
    </section>
  );
}

function contactLine(person: PersonRow): string {
  if (person.phone) return displayPhone(person.phone);
  const fromLogin = phoneFromLoginEmail(person.email);
  if (fromLogin) return displayPhone(fromLogin);
  return person.email ?? "Chưa có số";
}

export function PersonCard({
  person,
  selfId,
  onChanged,
  defaultOpen = false,
}: {
  person: PersonRow;
  selfId: string;
  onChanged: () => Promise<void>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState(person.fullName);
  const [employeeCode, setEmployeeCode] = useState(person.employeeCode ?? "");
  const [department, setDepartment] = useState(person.department ?? "");
  const [jobTitle, setJobTitle] = useState(person.jobTitle ?? "");
  const [startedOn, setStartedOn] = useState(person.startedOn ?? "");
  const [endedOn, setEndedOn] = useState(person.endedOn ?? "");
  const [isActive, setIsActive] = useState(person.isActive !== false);

  async function changeRole(role: Role) {
    setError("");
    try {
      await setRole({ data: { userId: person.userId, role } });
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminUpdateProfile({
        data: {
          userId: person.userId,
          fullName,
          employeeCode,
          department,
          jobTitle,
          startedOn,
          isActive,
          endedOn,
        },
      });
      await onChanged();
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-md border border-line bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{person.fullName}{person.userId === selfId ? " (bạn)" : ""}{isActive ? "" : " · đã nghỉ"}</p>
          <p className="text-sm text-muted">{contactLine(person)}</p>
          {person.department || person.employeeCode ? (
            <p className="text-xs text-muted">{[person.employeeCode, person.department, person.jobTitle].filter(Boolean).join(" · ")}</p>
          ) : null}
          {person.startedOn ? <p className="text-xs text-muted">Vào làm {person.startedOn.split("-").reverse().join("/")}</p> : null}
        </div>
        <button type="button" className="text-sm text-ink underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Đóng" : "Sửa"}
        </button>
      </div>
      <select
        className={`${fieldClass} mt-2`}
        value={person.role}
        onChange={(e) => void changeRole(e.target.value as Role)}
      >
        <option value="employee">Nhân viên</option>
        <option value="approver">Người duyệt</option>
        <option value="admin">Quản trị</option>
      </select>
      {open ? (
        <form onSubmit={saveProfile} className="mt-3 space-y-2 border-t border-line pt-3">
          <label className="block text-sm">
            Họ tên
            <input className={fieldClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="block text-sm">
            Mã nhân viên
            <input className={fieldClass} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
          </label>
          <label className="block text-sm">
            Phòng ban
            <input className={fieldClass} value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="block text-sm">
            Chức danh
            <input className={fieldClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
          <label className="block text-sm">
            Ngày vào làm
            <input className={fieldClass} type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </label>
          <label className="block text-sm">
            Ngày nghỉ việc
            <input className={fieldClass} type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang làm việc
          </label>
          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu hồ sơ"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

export function PeopleEditor({
  people,
  selfId,
  onChanged,
}: {
  people: PersonRow[];
  selfId: string;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Tất cả thành viên</h2>
      <p className="text-sm text-muted">Bấm “Sửa” cạnh tên để xem và chỉnh mã nhân viên, phòng ban, ngày vào làm, hoặc khóa tài khoản.</p>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {people.map((person) => (
        <PersonCard key={person.userId} person={person} selfId={selfId} onChanged={onChanged} />
      ))}
    </section>
  );
}
