import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { displayPhone, phoneFromLoginEmail } from "@/lib/phone";
import { CameraSheet } from "@/components/camera-sheet";
import { UserButton } from "@/lib/auth/gates";
import { errorText, fieldClass, primaryBtn, secondaryBtn } from "@/components/ui";
import { InviteCodeCard } from "@/components/invite-card";
import {
  createCorrection,
  createLeaveRequest,
  getPunchPhoto,
  listCorrections,
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
  PersonRow,
  PunchResult,
  PunchRow,
  RankLists,
  Role,
  Settings,
  WorkspaceData,
} from "@/lib/attendance-types";
import {
  formatMeters,
  formatMonthLabel,
  formatVnDay,
  isEarlyOut,
  minutesToHm,
  mondayIndex,
  daysInMonth,
  shiftMonth,
  todayLong,
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

function hmMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function shiftProgress(start: string, end: string, time: string): { pct: number; note: string } {
  const from = hmMin(start);
  const to = Math.max(from + 60, hmMin(end));
  const now = hmMin(time.slice(0, 5));
  const pct = Math.max(0, Math.min(100, ((now - from) / (to - from)) * 100));
  const rest = to - now;
  const note = now < from ? "Chưa đến giờ ca" : rest > 0 ? `Còn ${Math.floor(rest / 60)} giờ ${rest % 60} phút đến hết ca` : "Đã hết ca";
  return { pct, note };
}

function workedToday(rows: PunchRow[]): { minutes: number; open: boolean } {
  const sorted = [...rows].sort((a, b) => a.punchedAt.localeCompare(b.punchedAt));
  let minutes = 0;
  let openIn: string | null = null;
  for (const row of sorted) {
    if (row.type === "in") openIn = row.punchedAt;
    else if (openIn) {
      minutes += Math.max(0, (new Date(row.punchedAt).getTime() - new Date(openIn).getTime()) / 60000);
      openIn = null;
    }
  }
  if (openIn) minutes += Math.max(0, (Date.now() - new Date(openIn).getTime()) / 60000);
  return { minutes, open: openIn !== null };
}

export function PunchPanel({
  data,
  onChanged,
  onRequests,
}: {
  data: WorkspaceData;
  onChanged: () => Promise<void>;
  onRequests?: () => void;
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
  const firstIn = data.today.find((r) => r.type === "in");
  const worked = workedToday(data.today);
  const workedText = worked.minutes > 0 ? `${Math.floor(worked.minutes / 60)}h ${String(Math.floor(worked.minutes % 60)).padStart(2, "0")}` : "0h 00";
  const inLate = firstIn ? isLate(firstIn.lateMinutes, data.settings.lateMinutes) && vnWeekday(firstIn.punchedAt) !== 0 : false;
  const inNote = !firstIn ? "Chưa vào ca" : inLate ? `Muộn ${firstIn.lateMinutes} phút` : "Đúng giờ";
  const workedNote =
    worked.minutes >= data.settings.fullDayMinutes ? "Đủ công" : worked.open ? "Đang trong ca" : worked.minutes > 0 ? "Chưa đủ công" : "Chưa vào ca";
  const shift = shiftProgress(data.settings.workStart, data.settings.workEnd, clock.time);

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
    <div className="tech-stage flex min-h-full flex-col pb-4 text-ink md:pb-6">
      <header className="safe-top flex items-center justify-between gap-3 px-5 pb-1 md:px-8">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">{todayLong()}</p>
          <p className="truncate text-xl font-semibold md:text-2xl">
            {clock.hello}, {data.profile.fullName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hero-account">
            <UserButton />
          </div>
          <img src="/punch-logo.png" alt="Đại Phát Furniture" className="size-12 rounded-full md:size-14" />
        </div>
      </header>

      {active.length > 0 || data.settings.allowOffsite ? (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-xl border border-line bg-card/60 px-3.5 py-2.5 md:mx-8">
          <MapPin className="size-5 shrink-0 text-ok" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {active[0]?.name ?? data.companyName}
              {active.length > 1 ? ` +${active.length - 1} điểm` : ""}
            </p>
            <p className="truncate text-xs text-muted">
              {data.settings.allowOffsite ? "Được chấm ngoài điểm, sẽ báo quản trị" : `Điểm chấm công · bán kính ${active[0]?.radiusMeters ?? 0} m`}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-ok">GPS</span>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-4">
        <p className="font-display text-[clamp(3rem,15vw,4rem)] leading-none font-semibold tabular-nums tracking-tight md:text-[6rem]">
          {clock.time.slice(0, 5)}
          <span className="ml-1 text-2xl font-medium text-muted md:text-3xl">{clock.time.slice(6)}</span>
        </p>
        <p className="text-sm text-muted">
          Ca {data.settings.workStart} – {data.settings.workEnd}
        </p>
        <button
          type="button"
          disabled={busy || (!data.settings.allowOffsite && active.length === 0)}
          onClick={() => locateFirst(primary)}
          aria-label={busy ? "Đang ghi" : primary === "in" ? "Vào ca" : "Ra ca"}
          className="punch-float mt-4 disabled:opacity-40 md:mt-8"
        >
          <span className="punch-halo" aria-hidden="true" />
          <span className="punch-invite" aria-hidden="true" />
          <span className="punch-face">
            <img src="/punch-logo.png" alt="" className="punch-logo" />
          </span>
        </button>
        <p className="mt-6 font-display text-2xl font-bold tracking-wide text-ice md:mt-10 md:text-3xl">
          {primary === "in" ? "CHẠM ĐỂ VÀO CA" : "CHẠM ĐỂ RA CA"}
        </p>
        {active.length === 0 && !data.settings.allowOffsite ? (
          <p className="px-6 text-center text-sm text-clay">Chưa có điểm chấm công đang bật.</p>
        ) : null}
      </div>

      <div className="space-y-2.5 px-5 md:px-8">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-line bg-card/60 px-3.5 py-3">
            <p className="text-xs text-muted">Giờ vào</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{firstIn ? vnTime(firstIn.punchedAt) : "--:--"}</p>
            <p className={`text-xs font-semibold ${!firstIn ? "text-muted" : inLate ? "text-clay" : "text-ok"}`}>{inNote}</p>
          </div>
          <div className="rounded-xl border border-line bg-card/60 px-3.5 py-3">
            <p className="text-xs text-muted">Đã làm hôm nay</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{workedText}</p>
            <p className={`text-xs font-semibold ${workedNote === "Đủ công" ? "text-ok" : "text-muted"}`}>{workedNote}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ice px-3.5 py-3 text-[#2B1D12]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Ca làm hôm nay</p>
            <p className="font-display text-3xl leading-tight font-bold tabular-nums">
              {data.settings.workStart} – {data.settings.workEnd}
            </p>
            <div className="mt-1.5 h-1.5 rounded-full bg-[#2B1D12]/20">
              <div className="h-full rounded-full bg-[#2B1D12]" style={{ width: `${shift.pct}%` }} />
            </div>
            <p className="mt-1 text-xs">{shift.note}</p>
          </div>
          <button type="button" onClick={() => onRequests?.()} className="min-h-11 shrink-0 rounded-lg bg-[#2B1D12] px-4 text-sm font-semibold text-ice">
            Gửi đơn
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 pt-4">
        {result ? (
          <section className={`rounded-md border p-4 ${result.ok ? "border-ice bg-card text-ink" : "border-transparent bg-clay text-card"}`}>
            <p className="text-sm font-semibold">
              {result.ok ? (result.offsite ? "Đã ghi, ngoài điểm" : "Đã ghi nhận") : "Ngoài vị trí cho phép"}
            </p>
            <p className="mt-1 text-base leading-6">
              {result.ok
                ? result.offsite
                  ? "Lần này không nằm trong điểm cho phép. Quản trị và người duyệt đã được báo."
                  : `Chấm công tại ${result.nearestName}, cách tâm ${formatMeters(result.distanceMeters)}.`
                : result.message}
              {result.ok && result.lateMinutes >= data.settings.lateMinutes
                ? ` Muộn ${result.lateMinutes} phút, đã báo quản trị và người duyệt.`
                : ""}
              {result.ok && vnWeekday(result.punchedAt) === 0 && result.overtimeStatus !== "pending"
                ? " Chủ Nhật làm thì cả buổi tính tăng ca, chờ duyệt khi ra ca."
                : ""}
              {result.ok && result.overtimeStatus === "pending"
                ? ` Tăng ca ${minutesToHm(result.overtimeMinutes)}, chờ duyệt thì mới được tính.`
                : ""}
            </p>
          </section>
        ) : null}
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {geoFailed && pendingPhoto ? (
          <button type="button" className={`${secondaryBtn} w-full`} onClick={() => locateThenSubmit(geoFailed, pendingPhoto)}>
            Thử lấy GPS lại
          </button>
        ) : null}

        {data.today.length > 0 ? (
          <section className="space-y-2">
            <h3 className="font-display text-2xl font-semibold">Hôm nay</h3>
            {data.today.map((row) => (
              <PunchLine key={row.id} row={row} settings={data.settings} />
            ))}
          </section>
        ) : null}

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
  const [employeeCode, setEmployeeCode] = useState(data.profile.employeeCode ?? "");
  const [department, setDepartment] = useState(data.profile.department ?? "");
  const [jobTitle, setJobTitle] = useState(data.profile.jobTitle ?? "");
  const [startedOn, setStartedOn] = useState(data.profile.startedOn ?? "");
  const [avatar, setAvatar] = useState(data.profile.avatar ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
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
          employeeCode,
          department,
          jobTitle,
          startedOn,
          avatar: avatar && avatar !== data.profile.avatar ? avatar : "",
        },
      });
      setSaved(true);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex flex-col items-center rounded-lg border-[1.5px] border-ink bg-card px-5 py-6">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative grid size-28 place-items-center overflow-hidden rounded-full border border-line bg-paper text-2xl font-medium"
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
        <button type="button" className="mt-3 text-sm font-medium text-ink" onClick={() => fileRef.current?.click()}>
          Tải ảnh đại diện
        </button>
        <p className="mt-4 text-sm font-semibold text-ink">{data.companyName}</p>
        <p className="text-xl font-medium">{name || "Nhân viên"}</p>
        <p className="text-sm text-muted">{ROLE_LABEL[data.profile.role]}</p>
      </div>

      <div className="space-y-3 rounded-lg border-[1.5px] border-ink bg-card p-4">
        <label className="block space-y-1 text-sm">
          Họ tên
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <div className="space-y-1 text-sm">
          <p>Số đăng nhập</p>
          <p className="flex h-12 items-center rounded-md bg-paper px-3 text-base">
            {data.profile.phone ? displayPhone(data.profile.phone) : "Chưa gắn"}
          </p>
        </div>
        <label className="block space-y-1 text-sm">
          Mã nhân viên
          <input className={fieldClass} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} maxLength={20} placeholder="VD: NV014" />
        </label>
        <label className="block space-y-1 text-sm">
          Phòng ban
          <input className={fieldClass} value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={60} placeholder="VD: Kinh doanh" />
        </label>
        <label className="block space-y-1 text-sm">
          Chức danh
          <input className={fieldClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={60} placeholder="VD: Chuyên viên" />
        </label>
        <label className="block space-y-1 text-sm">
          Ngày vào làm
          <input className={fieldClass} type="date" value={startedOn} max={vnDateKey()} onChange={(e) => setStartedOn(e.target.value)} />
        </label>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {saved ? <p className="text-sm text-ok">Đã lưu hồ sơ.</p> : null}
        <button className={`${primaryBtn} w-full`} type="submit" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu hồ sơ"}
        </button>
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
  return { late, overtime: `Tăng ca ${hours} · dưới 1 giờ`, onTime: !isLate(firstIn?.lateMinutes ?? 0, settings.lateMinutes) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-card px-3 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-4xl font-semibold tabular-nums">{value}</p>
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
    <div className="rounded-md border border-line bg-card p-3">
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
              className={`grid h-10 place-items-center rounded-md text-sm tabular-nums ${
                picked === day ? "bg-pine text-card" : markClass(days.get(day) ?? "none")
              }`}
            >
              {Number(day.slice(8))}
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
  onChanged,
}: {
  canReview: boolean;
  maxCorrections: number;
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<CorrectionRow[] | null>(null);
  const [error, setError] = useState("");
  const [date, setDate] = useState(vnDateKey());
  const [punchType, setPunchType] = useState<"in" | "out">("in");
  const [requestedTime, setRequestedTime] = useState("08:00");
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

  return (
    <div className="space-y-4">
      {canReview ? (
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
      <form className="space-y-3 rounded-md border border-line bg-card p-4" onSubmit={submit}>
        <h2 className="font-display text-2xl font-semibold">Gửi đơn sửa</h2>
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
            <select className={fieldClass} value={punchType} onChange={(e) => setPunchType(e.target.value as "in" | "out")}>
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
        <button className={primaryBtn} type="submit" disabled={busy}>{busy ? "Đang gửi…" : "Gửi đơn"}</button>
      </form>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <LeaveSection canReview={canReview} userId={userId} onChanged={onChanged} />
      <section className="space-y-2">
        <h3 className="font-semibold">{canReview ? "Tất cả đơn" : "Đơn của tôi"}</h3>
        {rows == null ? <p className="text-sm text-muted">Đang tải đơn…</p> : null}
        {rows && archive.length === 0 ? <p className="text-sm text-muted">Chưa có đơn nào.</p> : null}
        {archive.map((row) => (
          <article key={`all-${row.id}`} className="rounded-md border border-line bg-card px-4 py-3">
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
      <form className="space-y-3 rounded-md border border-line bg-card p-4" onSubmit={submit}>
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

export function ManagePanel({ data, onChanged }: { data: WorkspaceData; onChanged: () => Promise<void> }) {
  const isAdmin = data.profile.role === "admin";
  const lateIds = new Set(data.lateToday.map((row) => row.userId).filter((id): id is string => Boolean(id)));
  return (
    <div className="space-y-5">
      <DayBoard data={data} />
      <TeamBoard people={data.teamToday} lateIds={lateIds} />
      <LateReport rows={data.lateToday} fromMinutes={data.settings.lateMinutes} />
      <OvertimeQueue rows={data.overtimePending} onChanged={onChanged} />
      {data.settings.allowOffsite || data.offsiteToday.length > 0 ? <OffsiteReport rows={data.offsiteToday} /> : null}
      <TimesheetExport />
      <section className="rounded-lg border-[1.5px] border-ink bg-card p-4">
        <h2 className="font-display text-2xl font-semibold">Nhân sự</h2>
        <p className="mt-1 text-sm text-muted">Danh sách tất cả thành viên. Quản trị bấm “Sửa” để cập nhật hồ sơ hoặc khóa tài khoản.</p>
        <div className="mt-3">
          <PeopleEditor people={data.teamToday} selfId={data.profile.userId} onChanged={onChanged} />
        </div>
      </section>
      {isAdmin ? (
        <details className="rounded-lg border-[1.5px] border-ink bg-card p-4">
          <summary className="font-display cursor-pointer text-2xl font-semibold">Cài đặt công ty</summary>
          <div className="mt-4 space-y-4">
            <InviteCodeCard />
            <SettingsForm data={data} onChanged={onChanged} />
            <LocationEditor locations={data.locations} onChanged={onChanged} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DayBoard({ data }: { data: WorkspaceData }) {
  const people = data.teamToday;
  const inside = people.filter((person) => person.lastType === "in").length;
  const left = people.filter((person) => person.lastType === "out").length;
  const missing = people.filter((person) => !person.lastAt).length;
  const attention = data.lateToday.length + data.overtimePending.length + data.offsiteToday.length + data.pendingCount;
  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm text-muted">Hôm nay</p>
        <h2 className="font-display text-4xl font-semibold">{data.profile.role === "admin" ? "Bảng quản trị" : "Bảng đội"}</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Glance label="Đang trong ca" value={inside} tone="pine" />
        <Glance label="Đã ra" value={left} tone="ok" />
        <Glance label="Chưa chấm" value={missing} tone={missing > 0 ? "clay" : "muted"} />
        <Glance label="Cần xử lý" value={attention} tone={attention > 0 ? "clay" : "muted"} />
      </div>
    </section>
  );
}

function Glance({ label, value, tone }: { label: string; value: number; tone: "pine" | "ok" | "clay" | "muted" }) {
  const toneClass =
    tone === "pine" ? "text-ink" : tone === "ok" ? "text-ok" : tone === "clay" ? "text-clay" : "text-muted";
  return (
    <article className="rounded-lg border-[1.5px] border-ink bg-card px-4 py-3">
      <p className={`font-display text-5xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </article>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function LateReport({ rows, fromMinutes }: { rows: PunchRow[]; fromMinutes: number }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-2xl font-semibold">Đi muộn hôm nay</h2>
      {rows.length === 0 ? <p className="text-sm text-muted">Chưa có ai muộn từ {fromMinutes} phút.</p> : null}
      {rows.map((row) => (
        <article key={row.id} className="flex items-center gap-3 rounded-md border border-line bg-card px-4 py-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-clay/10 text-sm font-semibold text-clay">
            {initials(row.fullName ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{row.fullName ?? "Nhân viên"}</p>
            <p className="text-sm text-muted">Vào lúc {vnTime(row.punchedAt)}</p>
          </div>
          <p className="text-right text-sm font-semibold text-clay">+{row.lateMinutes} phút</p>
        </article>
      ))}
    </section>
  );
}

function OvertimeQueue({ rows, onChanged }: { rows: PunchRow[]; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function decide(id: number, decision: "approved" | "rejected") {
    setError("");
    try {
      await reviewOvertime({ data: { id, decision } });
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section className="space-y-2">
      <h2 className="font-display text-2xl font-semibold">Tăng ca chờ duyệt</h2>
      {rows.length === 0 ? <p className="text-sm text-muted">Chưa có tăng ca từ 1 giờ.</p> : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {rows.map((row) => (
        <article key={row.id} className="rounded-md border border-line bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sand text-sm font-semibold">
              {initials(row.fullName ?? "?")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{row.fullName ?? "Nhân viên"}</p>
              <p className="text-sm text-muted">Ra lúc {vnTime(row.punchedAt)}</p>
            </div>
            <p className="text-right font-display text-2xl font-semibold tabular-nums">{minutesToHm(row.overtimeMinutes)}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className={primaryBtn} onClick={() => void decide(row.id, "approved")}>
              Chấp nhận
            </button>
            <button type="button" className={secondaryBtn} onClick={() => void decide(row.id, "rejected")}>
              Từ chối
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function OffsiteCard({ row }: { row: PunchRow }) {
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <article className="rounded-md border border-line bg-card px-4 py-3">
      <p className="font-medium">{row.fullName ?? "Nhân viên"}</p>
      <p className="text-sm text-muted">
        {vnTime(row.punchedAt)} · {row.type === "in" ? "Vào" : "Ra"}
        {row.nearestName ? ` · gần ${row.nearestName}` : ""}
        {row.distanceMeters != null ? ` · ${formatMeters(row.distanceMeters)}` : ""}
      </p>
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
      ) : (
        <p className="mt-2 text-sm text-muted">Không có ảnh</p>
      )}
      {photo ? <img src={photo} alt="Ảnh chấm công" className="mt-3 max-h-64 w-full rounded-md object-cover" /> : null}
    </article>
  );
}

function OffsiteReport({ rows }: { rows: PunchRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-2xl font-semibold">Chấm ngoài điểm hôm nay</h2>
      {rows.length === 0 ? <p className="text-sm text-muted">Chưa có lần nào.</p> : null}
      {rows.map((row) => (
        <OffsiteCard key={row.id} row={row} />
      ))}
    </section>
  );
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
    <section className="space-y-3 rounded-md border border-line bg-card p-4">
      <h2 className="font-display text-2xl font-semibold">Bảng công tháng</h2>
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

function TeamBoard({ people, lateIds }: { people: PersonRow[]; lateIds: Set<string> }) {
  const inside = people.filter((person) => person.lastType === "in");
  const left = people.filter((person) => person.lastType === "out");
  const missing = people.filter((person) => !person.lastAt);
  return (
    <section className="space-y-4">
      <PersonGroup title="Đang trong ca" people={inside} lateIds={lateIds} empty="Chưa ai đang trong ca." />
      <PersonGroup title="Đã ra" people={left} lateIds={lateIds} empty="Chưa ai ra ca." />
      <PersonGroup title="Chưa chấm" people={missing} lateIds={lateIds} empty="Mọi người đã chấm." />
    </section>
  );
}

function PersonGroup({
  title,
  people,
  lateIds,
  empty,
}: {
  title: string;
  people: PersonRow[];
  lateIds: Set<string>;
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <span className="text-sm tabular-nums text-muted">{people.length}</span>
      </div>
      {people.length === 0 ? <p className="text-sm text-muted">{empty}</p> : null}
      {people.map((person) => {
        const late = lateIds.has(person.userId);
        const tone = late ? "bg-clay/10 text-clay" : person.lastType === "out" ? "bg-ok/10 text-ok" : person.lastType === "in" ? "bg-pine/10 text-ink" : "bg-sand text-muted";
        return (
          <article key={person.userId} className="flex items-center gap-3 rounded-md border border-line bg-card px-4 py-3">
            <span className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${tone}`}>
              {initials(person.fullName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{person.fullName}</p>
              <p className="text-sm text-muted">{ROLE_LABEL[person.role]}</p>
            </div>
            <p className={`text-sm font-semibold ${late ? "text-clay" : "text-ink"}`}>
              {person.lastAt ? vnTime(person.lastAt) : "—"}
            </p>
          </article>
        );
      })}
    </div>
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
    <form className="space-y-3 rounded-md border border-line bg-card p-4" onSubmit={submit}>
      <h2 className="font-semibold">Giờ và quy tắc</h2>
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
      <h2 className="font-semibold">Điểm chấm công</h2>
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
      <form className="space-y-3 rounded-md border border-line bg-card p-4" onSubmit={submit}>
        <h3 className="font-medium">{form.id ? "Sửa điểm" : "Thêm điểm"}</h3>
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
