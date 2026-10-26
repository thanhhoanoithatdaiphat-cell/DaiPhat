import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Search, X } from "lucide-react";
import { errorText } from "@/components/ui";
import { getHistory, listAudit } from "@/lib/attendance.functions";
import { HISTORY_MAX_DAYS, type AuditEvent, type HistoryData } from "@/lib/attendance-types";
import { scheduleOf } from "@/lib/attendance-types";
import { buildCell, summarize, weekdayOf, type CellKind, type DayCell } from "@/lib/month-grid";
import { formatMeters, minutesToHm, nextDateKey, vnDateKey, vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { compareByCode } from "@/lib/employee-order";
import { Card, Chip, PageHero, PunchPhoto, useClickAway } from "./common";

type Tab = "day" | "punch" | "audit";
type StatusFilter = "all" | "ok" | "late" | "partial" | "absent" | "leave" | "offsite" | "corrected" | "overtime";

const PAGE_SIZE = 50;
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const KIND_TEXT: Record<CellKind, string> = {
  ok: "Đủ công",
  late: "Đi muộn",
  partial: "Thiếu giờ vào/ra",
  absent: "Vắng",
  off: "Nghỉ",
  future: "Chưa tới",
};
const KIND_TONE: Record<CellKind, "ok" | "late" | "clay" | "muted"> = {
  ok: "ok",
  late: "late",
  partial: "clay",
  absent: "clay",
  off: "muted",
  future: "muted",
};
const LEAVE_TEXT: Record<string, string> = { P: "Nghỉ phép", "Ố": "Nghỉ ốm", T: "Thai sản", L: "Ngày lễ" };
const STATUS_OPTIONS: [StatusFilter, string][] = [
  ["all", "Tất cả trạng thái"],
  ["ok", "Đủ công"],
  ["late", "Đi muộn"],
  ["partial", "Thiếu giờ vào/ra"],
  ["absent", "Vắng"],
  ["leave", "Nghỉ phép / lễ"],
  ["offsite", "Chấm ngoài vùng"],
  ["corrected", "Sửa theo đơn"],
  ["overtime", "Có tăng ca"],
];
const AUDIT_KIND: Record<AuditEvent["kind"], string> = { correction: "Sửa công", leave: "Nghỉ phép", overtime: "Tăng ca" };
const AUDIT_STATUS: Record<AuditEvent["status"], { text: string; tone: "ok" | "clay" | "late" }> = {
  approved: { text: "Đã duyệt", tone: "ok" },
  rejected: { text: "Từ chối", tone: "clay" },
  pending: { text: "Chờ duyệt", tone: "late" },
};

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}
function monthEnd(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function fmtDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return `${fmtDate(vnDateKey(iso))} ${vnTime(iso)}`;
}
function fmtCong(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
function downloadCsv(filename: string, header: string[], lines: string[][]) {
  const body = [header, ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function dayLabel(cell: DayCell): string {
  return cell.kind === "off" ? (LEAVE_TEXT[cell.label] ?? "Nghỉ") : KIND_TEXT[cell.kind];
}

type DayRow = {
  key: string;
  userId: string;
  fullName: string;
  code: string | null;
  dept: string | null;
  date: string;
  cell: DayCell;
  locations: string;
  punchCount: number;
};
type PunchRowX = {
  id: number;
  userId: string;
  fullName: string;
  code: string | null;
  dept: string | null;
  at: string;
  type: "in" | "out";
  status: "valid" | "corrected";
  offsite: boolean;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: string;
  place: string;
  distanceMeters: number | null;
  hasPhoto: boolean;
};

export function HistoryView({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const today = vnDateKey();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [hist, setHist] = useState<HistoryData | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("day");
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<{ userId: string; date: string } | null>(null);

  const rangeError = from > to ? "Ngày bắt đầu phải trước ngày kết thúc" : (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1 > HISTORY_MAX_DAYS ? `Chỉ xem tối đa ${HISTORY_MAX_DAYS} ngày mỗi lần` : "";

  const load = useCallback(async () => {
    if (rangeError) return;
    try {
      const [h, a] = await Promise.all([getHistory({ data: { from, to } }), listAudit({ data: { from, to } })]);
      setHist(h);
      setAudit(a);
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [from, to, rangeError]);

  // Đổi khoảng ngày: xóa dữ liệu cũ rồi tải lại.
  useEffect(() => {
    setHist(null);
    setAudit(null);
    setPage(1);
  }, [from, to]);
  // Tải lại khi đổi khoảng ngày, và khi số đơn đã duyệt / tăng ca chờ duyệt thay đổi (giữ nguyên dữ liệu đang xem).
  const decided = ctx.corrections.filter((c) => c.status !== "pending").length + ctx.leaves.filter((l) => l.status !== "pending").length;
  useEffect(() => {
    void load();
  }, [load, decided, data.overtimePending.length]);
  useEffect(() => setPage(1), [tab, query, dept, status, asc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const detailRef = useRef<HTMLElement>(null);
  useClickAway(detailRef, () => setDetail(null), detail !== null);

  const dayRows = useMemo<DayRow[]>(() => {
    if (!hist) return [];
    const out: DayRow[] = [];
    const holidays = new Set(hist.holidays);
    for (let d = hist.from; d <= hist.to; d = nextDateKey(d)) {
      for (const p of hist.people) {
        const punches = hist.punches[p.userId]?.[d] ?? [];
        const cell = buildCell({
          dateKey: d,
          punches,
          todayKey: hist.todayKey,
          startedOn: p.startedOn,
          endedOn: p.endedOn,
          isHoliday: holidays.has(d),
          hasApprovedLeave: !!hist.leaves[p.userId]?.[d],
          leaveKind: hist.leaves[p.userId]?.[d] ?? null,
          lateThreshold: data.settings.lateMinutes,
          schedule: scheduleOf(data.settings),
          fullDayMinutes: data.settings.fullDayMinutes,
          halfDayMinutes: data.settings.halfDayMinutes,
          hm: vnTime,
        });
        if (cell.kind === "future") continue;
        if (cell.kind === "off" && !cell.label) continue;
        if (p.isActive === false && punches.length === 0) continue;
        out.push({
          key: `${p.userId}|${d}`,
          userId: p.userId,
          fullName: p.fullName,
          code: p.employeeCode,
          dept: p.department,
          date: d,
          cell,
          locations: [...new Set(punches.map((x) => x.nearestName).filter(Boolean))].join(", "),
          punchCount: punches.length,
        });
      }
    }
    return out;
  }, [hist, data.settings]);

  const punchRows = useMemo<PunchRowX[]>(() => {
    if (!hist) return [];
    const byId = new Map(hist.people.map((p) => [p.userId, p]));
    const out: PunchRowX[] = [];
    for (const [userId, days] of Object.entries(hist.punches)) {
      const p = byId.get(userId);
      for (const list of Object.values(days)) {
        for (const x of list) {
          out.push({
            id: x.id,
            userId,
            fullName: p?.fullName ?? "(đã xóa)",
            code: p?.employeeCode ?? null,
            dept: p?.department ?? null,
            at: x.at,
            type: x.type,
            status: x.status,
            offsite: x.offsite,
            lateMinutes: x.lateMinutes,
            overtimeMinutes: x.overtimeMinutes,
            overtimeStatus: x.overtimeStatus,
            place: x.nearestName ?? "",
            distanceMeters: x.distanceMeters,
            hasPhoto: x.hasPhoto,
          });
        }
      }
    }
    return out;
  }, [hist]);

  const depts = useMemo(
    () => [...new Set((hist?.people ?? []).map((p) => p.department ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [hist],
  );
  const q = query.trim().toLowerCase();
  const who = (r: { fullName: string; code: string | null; dept: string | null }) =>
    (!q || r.fullName.toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q)) && (!dept || (r.dept ?? "") === dept);

  const shownDays = useMemo(() => {
    const list = dayRows.filter((r) => {
      if (!who(r)) return false;
      const c = r.cell;
      switch (status) {
        case "all": return true;
        case "ok": return c.kind === "ok";
        case "late": return c.kind === "late";
        case "partial": return c.kind === "partial";
        case "absent": return c.kind === "absent";
        case "leave": return c.kind === "off";
        case "offsite": return c.offsite;
        case "corrected": return c.corrected;
        case "overtime": return c.overtimeMinutes > 0;
      }
    });
    list.sort((a, b) => (asc ? 1 : -1) * a.date.localeCompare(b.date) || compareByCode({ employeeCode: a.code, fullName: a.fullName }, { employeeCode: b.code, fullName: b.fullName }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayRows, q, dept, status, asc]);

  const shownPunches = useMemo(() => {
    const list = punchRows.filter((r) => {
      if (!who(r)) return false;
      switch (status) {
        case "all": return true;
        case "late": return r.type === "in" && r.lateMinutes > 0;
        case "offsite": return r.offsite;
        case "corrected": return r.status === "corrected";
        case "overtime": return r.overtimeMinutes > 0;
        default: return true;
      }
    });
    list.sort((a, b) => (asc ? 1 : -1) * a.at.localeCompare(b.at));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punchRows, q, dept, status, asc]);

  const shownAudit = useMemo(
    () =>
      (audit ?? []).filter((e) => {
        const p = hist?.people.find((x) => x.userId === e.userId);
        if (!who({ fullName: e.fullName, code: p?.employeeCode ?? null, dept: p?.department ?? null })) return false;
        return status === "all" || status === "corrected" || status === "overtime" || status === "leave"
          ? status === "all" || (status === "corrected" && e.kind === "correction") || (status === "overtime" && e.kind === "overtime") || (status === "leave" && e.kind === "leave")
          : true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audit, hist, q, dept, status],
  );

  const kpi = useMemo(() => {
    const cells = dayRows.map((r) => r.cell);
    const s = summarize(cells, { sunday: ctx.data.settings.sundayRate, holiday: ctx.data.settings.holidayRate });
    return {
      punches: punchRows.length,
      workDays: s.days,
      cong: s.congQuyDoi,
      late: s.late,
      absent: s.absent,
      partial: s.partial,
      offsite: punchRows.filter((r) => r.offsite).length,
      corrected: punchRows.filter((r) => r.status === "corrected").length,
      pending: (audit ?? []).filter((e) => e.status === "pending").length,
    };
  }, [dayRows, punchRows, audit, ctx.data.settings.sundayRate, ctx.data.settings.holidayRate]);

  const total = tab === "day" ? shownDays.length : tab === "punch" ? shownPunches.length : shownAudit.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const slice = <T,>(list: T[]) => list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  function preset(kind: "today" | "7" | "30" | "month" | "prev") {
    const set = (a: string, b: string) => {
      setFrom(a);
      setTo(b);
    };
    if (kind === "today") set(today, today);
    else if (kind === "7") set(addDays(today, -6), today);
    else if (kind === "30") set(addDays(today, -29), today);
    else if (kind === "month") set(monthStart(today), today);
    else {
      const prevEnd = addDays(monthStart(today), -1);
      setFrom(monthStart(prevEnd));
      setTo(monthEnd(prevEnd));
    }
  }

  function exportCsv() {
    const name = `lich-su-cham-cong-${from}_${to}`;
    if (tab === "day") {
      downloadCsv(`${name}-theo-ngay.csv`, ["Ngày", "Thứ", "Mã NV", "Nhân viên", "Phòng ban", "Trạng thái", "Giờ vào", "Giờ ra", "Giờ làm", "Công", "Phút muộn", "Tăng ca", "Ngoài vùng", "Sửa theo đơn", "Địa điểm"],
        shownDays.map((r) => [
          fmtDate(r.date), WEEKDAY[weekdayOf(r.date)], r.code ?? "", r.fullName, r.dept ?? "", dayLabel(r.cell),
          r.cell.firstIn ? vnTime(r.cell.firstIn) : "", r.cell.lastOut ? vnTime(r.cell.lastOut) : "",
          r.cell.workedMinutes ? minutesToHm(r.cell.workedMinutes) : "", r.cell.cong == null ? "" : fmtCong(r.cell.cong),
          String(r.cell.lateMinutes || ""), r.cell.overtimeMinutes ? `${minutesToHm(r.cell.overtimeMinutes)} (${r.cell.overtimeStatus})` : "",
          r.cell.offsite ? "Có" : "", r.cell.corrected ? "Có" : "", r.locations,
        ]));
    } else if (tab === "punch") {
      downloadCsv(`${name}-tung-luot.csv`, ["Ngày", "Giờ", "Mã NV", "Nhân viên", "Phòng ban", "Loại", "Địa điểm", "Khoảng cách (m)", "Phút muộn", "Tăng ca (phút)", "Trạng thái tăng ca", "Ngoài vùng", "Theo đơn", "Có ảnh"],
        shownPunches.map((r) => [
          fmtDate(vnDateKey(r.at)), vnTime(r.at), r.code ?? "", r.fullName, r.dept ?? "", r.type === "in" ? "Vào" : "Ra", r.place,
          r.distanceMeters == null ? "" : String(r.distanceMeters), String(r.lateMinutes || ""), String(r.overtimeMinutes || ""),
          r.overtimeMinutes ? r.overtimeStatus : "", r.offsite ? "Có" : "", r.status === "corrected" ? "Có" : "", r.hasPhoto ? "Có" : "",
        ]));
    } else {
      downloadCsv(`${name}-nhat-ky-duyet.csv`, ["Loại", "Ngày công", "Nhân viên", "Nội dung", "Lý do", "Trạng thái", "Gửi lúc", "Người duyệt", "Duyệt lúc", "Ghi chú duyệt"],
        shownAudit.map((e) => [AUDIT_KIND[e.kind], fmtDate(e.date), e.fullName, e.subject, e.note, AUDIT_STATUS[e.status].text, fmtDateTime(e.createdAt), e.reviewedByName ?? "", fmtDateTime(e.reviewedAt), e.reviewNote ?? ""]));
    }
  }

  const loading = !hist && !error && !rangeError;
  /** Đổi tab bằng tay: bộ lọc trạng thái của tab trước có thể không còn hợp lệ nên về "Tất cả". */
  const switchTab = (k: Tab) => {
    setTab(k);
    setStatus("all");
  };
  const detailPerson = detail && hist ? hist.people.find((p) => p.userId === detail.userId) : undefined;
  const detailPunches = detail && hist ? (hist.punches[detail.userId]?.[detail.date] ?? []) : [];
  const detailCell = detail ? dayRows.find((r) => r.key === `${detail.userId}|${detail.date}`)?.cell : undefined;
  const detailAudit = detail ? (audit ?? []).filter((e) => e.userId === detail.userId && e.date === detail.date) : [];

  return (
    <div className="space-y-4">
      <PageHero title="Lịch sử chấm công" subtitle="Toàn bộ lượt chấm, ngày công và nhật ký duyệt của mọi nhân viên theo khoảng ngày." />

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            Từ
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-10 rounded-md border border-edge bg-card px-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            đến
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-10 rounded-md border border-edge bg-card px-2 text-sm" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {([["today", "Hôm nay"], ["7", "7 ngày"], ["30", "30 ngày"], ["month", "Tháng này"], ["prev", "Tháng trước"]] as const).map(([k, t]) => (
              <button key={k} type="button" onClick={() => preset(k)} className="h-9 rounded-md border border-edge bg-card px-3 text-sm font-semibold hover:bg-ice">
                {t}
              </button>
            ))}
          </div>
          {hist && hist.lockedMonths.length ? (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3" /> Đã chốt: {hist.lockedMonths.map((m) => `${m.slice(5)}/${m.slice(0, 4)}`).join(", ")}
            </span>
          ) : null}
        </div>
      </Card>

      {rangeError ? <p className="text-sm text-clay">{rangeError}</p> : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {hist?.truncated ? <p className="rounded-md border-[1.5px] border-clay bg-clay/10 px-3 py-2 text-sm">Có quá nhiều lượt chấm trong khoảng này nên danh sách bị cắt bớt. Hãy thu hẹp khoảng ngày để xem đầy đủ.</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Lượt chấm" value={kpi.punches} />
        <Kpi label="Tổng công" value={fmtCong(kpi.cong)} />
        <Kpi label="Đi muộn" value={kpi.late} onClick={() => { setTab("day"); setStatus("late"); }} />
        <Kpi label="Vắng" value={kpi.absent} tone="text-clay" onClick={() => { setTab("day"); setStatus("absent"); }} />
        <Kpi label="Thiếu giờ" value={kpi.partial} tone="text-clay" onClick={() => { setTab("day"); setStatus("partial"); }} />
        <Kpi label="Ngoài vùng" value={kpi.offsite} onClick={() => { setTab("punch"); setStatus("offsite"); }} />
        <Kpi label="Sửa theo đơn" value={kpi.corrected} onClick={() => { setTab("punch"); setStatus("corrected"); }} />
        <Kpi label="Chờ duyệt" value={kpi.pending} onClick={() => ctx.go("inbox")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="tablist" aria-label="Kiểu xem lịch sử">
          {([["day", "Theo ngày"], ["punch", "Từng lượt chấm"], ["audit", "Nhật ký duyệt"]] as const).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => switchTab(k)} className={`h-10 px-4 ${tab === k ? "bg-night text-ice" : "bg-card"}`}>
              {t}
            </button>
          ))}
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên hoặc mã NV" className="h-10 w-48 rounded-md border border-edge bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice" />
        </label>
        {depts.length ? (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Lọc theo phòng ban" className="h-10 rounded-md border border-edge bg-card px-3 text-sm">
            <option value="">Tất cả phòng ban</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : null}
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Lọc theo trạng thái" className="h-10 rounded-md border border-edge bg-card px-3 text-sm">
          {STATUS_OPTIONS.filter(([k]) => tab === "day" || (tab === "punch" ? ["all", "late", "offsite", "corrected", "overtime"].includes(k) : ["all", "corrected", "overtime", "leave"].includes(k))).map(([k, t]) => (
            <option key={k} value={k}>{tab === "audit" && k === "corrected" ? "Đơn sửa công" : tab === "audit" && k === "overtime" ? "Tăng ca" : tab === "audit" && k === "leave" ? "Đơn nghỉ" : t}</option>
          ))}
        </select>
        <button type="button" onClick={() => setAsc((v) => !v)} className="h-10 rounded-md border border-edge bg-card px-3 text-sm font-semibold">
          {asc ? "Cũ nhất trước ↑" : "Mới nhất trước ↓"}
        </button>
        <button type="button" disabled={!hist || total === 0} onClick={exportCsv} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-ice px-4 text-sm font-semibold shadow-[0_3px_0_var(--color-ink)] disabled:opacity-40">
          <Download className="size-4" /> Tải CSV ({total})
        </button>
      </div>

      {loading ? <p className="py-10 text-sm text-muted">Đang tải lịch sử…</p> : null}

      {hist && tab === "day" ? (
        <Table
          head={["Ngày", "Nhân viên", "Trạng thái", "Vào", "Ra", "Giờ làm", "Công", "Địa điểm", ""]}
          empty={shownDays.length === 0}
        >
          {slice(shownDays).map((r) => (
            <tr key={r.key} className="cursor-pointer border-b border-line hover:bg-paper" onClick={() => setDetail({ userId: r.userId, date: r.date })}>
              <Td><span className="tabular-nums">{fmtDate(r.date)}</span> <span className="text-xs text-muted">{WEEKDAY[weekdayOf(r.date)]}</span></Td>
              <Td><Person name={r.fullName} sub={[r.code, r.dept].filter(Boolean).join(" · ")} /></Td>
              <Td>
                <Chip tone={KIND_TONE[r.cell.kind]}>{dayLabel(r.cell)}</Chip>
                {r.cell.lateMinutes > 0 ? <span className="ml-1 text-xs text-muted">+{r.cell.lateMinutes}′</span> : null}
              </Td>
              <Td mono>{r.cell.firstIn ? vnTime(r.cell.firstIn) : "–"}</Td>
              <Td mono>{r.cell.lastOut ? vnTime(r.cell.lastOut) : "–"}</Td>
              <Td mono>{r.cell.workedMinutes ? minutesToHm(r.cell.workedMinutes) : "–"}</Td>
              <Td mono>{r.cell.cong == null ? "–" : fmtCong(r.cell.cong)}</Td>
              <Td><span className="line-clamp-1 max-w-48 text-muted">{r.locations || "—"}</span></Td>
              <Td>
                <span className="flex gap-1">
                  {r.cell.offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
                  {r.cell.corrected ? <Chip tone="muted">Theo đơn</Chip> : null}
                  {r.cell.overtimeMinutes > 0 ? <Chip tone="ink">TC {minutesToHm(r.cell.overtimeMinutes)}</Chip> : null}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      ) : null}

      {hist && tab === "punch" ? (
        <Table head={["Thời gian", "Nhân viên", "Loại", "Địa điểm", "Muộn", "Tăng ca", "Ghi chú", "Ảnh"]} empty={shownPunches.length === 0}>
          {slice(shownPunches).map((r) => (
            <tr key={r.id} className="cursor-pointer border-b border-line hover:bg-paper" onClick={() => setDetail({ userId: r.userId, date: vnDateKey(r.at) })}>
              <Td><span className="tabular-nums">{fmtDate(vnDateKey(r.at))}</span> <span className="font-display text-lg font-semibold tabular-nums">{vnTime(r.at)}</span></Td>
              <Td><Person name={r.fullName} sub={[r.code, r.dept].filter(Boolean).join(" · ")} /></Td>
              <Td><Chip tone={r.type === "in" ? "ok" : "ink"}>{r.type === "in" ? "VÀO" : "RA"}</Chip></Td>
              <Td><span className="text-muted">{r.place || "Không rõ"}{r.distanceMeters != null ? ` · ${formatMeters(r.distanceMeters)}` : ""}</span></Td>
              <Td mono>{r.type === "in" && r.lateMinutes > 0 ? `${r.lateMinutes} phút` : "–"}</Td>
              <Td mono>{r.overtimeMinutes > 0 ? `${minutesToHm(r.overtimeMinutes)}` : "–"}{r.overtimeMinutes > 0 ? <span className="ml-1 text-xs text-muted">{AUDIT_STATUS[r.overtimeStatus as AuditEvent["status"]]?.text ?? ""}</span> : null}</Td>
              <Td>
                <span className="flex gap-1">
                  {r.offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
                  {r.status === "corrected" ? <Chip tone="muted">Theo đơn</Chip> : null}
                </span>
              </Td>
              <Td>{r.hasPhoto ? "📷" : "–"}</Td>
            </tr>
          ))}
        </Table>
      ) : null}

      {hist && audit && tab === "audit" ? (
        <Table head={["Loại", "Ngày công", "Nhân viên", "Nội dung", "Trạng thái", "Người duyệt", "Duyệt lúc", "Ghi chú"]} empty={shownAudit.length === 0}>
          {slice(shownAudit).map((e) => (
            <tr key={e.key} className="cursor-pointer border-b border-line align-top hover:bg-paper" onClick={() => setDetail({ userId: e.userId, date: e.date })}>
              <Td><Chip tone="muted">{AUDIT_KIND[e.kind]}</Chip></Td>
              <Td><span className="tabular-nums">{fmtDate(e.date)}</span></Td>
              <Td>{e.fullName}</Td>
              <Td>
                <span className="block">{e.subject}</span>
                {e.note ? <span className="block max-w-64 text-xs text-muted">{e.note}</span> : null}
                <span className="block text-xs text-muted">Gửi {fmtDateTime(e.createdAt)}</span>
              </Td>
              <Td><Chip tone={AUDIT_STATUS[e.status].tone}>{AUDIT_STATUS[e.status].text}</Chip></Td>
              <Td>{e.reviewedByName ?? (e.status === "pending" ? "—" : "Không rõ")}</Td>
              <Td><span className="tabular-nums">{fmtDateTime(e.reviewedAt)}</span></Td>
              <Td><span className="block max-w-56 text-muted">{e.reviewNote || "—"}</span></Td>
            </tr>
          ))}
        </Table>
      ) : null}

      {hist ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            {total} dòng · trang {cur}/{pages} · {fmtDate(from)} → {fmtDate(to)}
          </span>
          <span className="flex gap-1">
            <button type="button" aria-label="Trang trước" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="grid size-9 place-items-center rounded-md border border-edge bg-card disabled:opacity-30">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" aria-label="Trang sau" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="grid size-9 place-items-center rounded-md border border-edge bg-card disabled:opacity-30">
              <ChevronRight className="size-5" />
            </button>
          </span>
        </div>
      ) : null}

      {detail && detailPerson ? (
        <aside ref={detailRef} className="fixed inset-y-0 right-0 z-30 w-full overflow-y-auto border-l-2 border-ink bg-card p-5 shadow-2xl sm:w-[26rem]" aria-label="Chi tiết ngày">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-3xl font-semibold">{detailPerson.fullName}</p>
              <p className="text-sm text-muted">
                {fmtDate(detail.date)} · {WEEKDAY[weekdayOf(detail.date)]}
                {[detailPerson.employeeCode, detailPerson.department].filter(Boolean).length ? ` · ${[detailPerson.employeeCode, detailPerson.department].filter(Boolean).join(" · ")}` : ""}
              </p>
            </div>
            <button type="button" aria-label="Đóng" className="grid size-9 place-items-center rounded-md border border-edge" onClick={() => setDetail(null)}>
              <X className="size-5" />
            </button>
          </div>
          {detailCell ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={KIND_TONE[detailCell.kind]}>{dayLabel(detailCell)}</Chip>
              {detailCell.cong != null && detailCell.kind !== "absent" ? <Chip tone="ink">{fmtCong(detailCell.cong)} công</Chip> : null}
              {detailCell.workedMinutes > 0 ? <Chip tone="muted">Làm {minutesToHm(detailCell.workedMinutes)}</Chip> : null}
              {detailCell.lateMinutes > 0 ? <Chip tone="late">Muộn {detailCell.lateMinutes} phút</Chip> : null}
            </div>
          ) : null}
          {detailPunches.length === 0 ? (
            <p className="mt-6 text-sm text-muted">Không có lượt chấm nào trong ngày này.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {detailPunches.map((p) => (
                <li key={p.id} className="space-y-2 border-l-4 border-ink pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-4xl leading-none font-semibold tabular-nums">{vnTime(p.at)}</span>
                    <Chip tone={p.type === "in" ? "ok" : "ink"}>{p.type === "in" ? "VÀO" : "RA"}</Chip>
                    {p.status === "corrected" ? <Chip tone="muted">Theo đơn</Chip> : null}
                    {p.offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
                  </div>
                  <p className="text-sm text-muted">
                    {p.nearestName ?? "Không rõ địa điểm"}
                    {p.distanceMeters != null ? ` · cách ${formatMeters(p.distanceMeters)}` : ""}
                    {p.lateMinutes > 0 ? ` · muộn ${p.lateMinutes} phút` : ""}
                    {p.overtimeMinutes > 0 ? ` · tăng ca ${minutesToHm(p.overtimeMinutes)} (${p.overtimeStatus === "approved" ? "đã duyệt" : p.overtimeStatus === "pending" ? "chờ duyệt" : p.overtimeStatus === "rejected" ? "từ chối" : "chưa tính"})` : ""}
                  </p>
                  {p.hasPhoto ? <PunchPhoto id={p.id} /> : null}
                </li>
              ))}
            </ul>
          )}
          {detailAudit.length ? (
            <section className="mt-6">
              <h3 className="text-sm font-semibold">Đơn và lượt duyệt của ngày này</h3>
              <ul className="mt-2 space-y-2">
                {detailAudit.map((e) => (
                  <li key={e.key} className="rounded-md border border-line bg-paper p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{AUDIT_KIND[e.kind]} · {e.subject}</span>
                      <Chip tone={AUDIT_STATUS[e.status].tone}>{AUDIT_STATUS[e.status].text}</Chip>
                    </div>
                    {e.note ? <p className="mt-1 text-muted">{e.note}</p> : null}
                    <p className="mt-1 text-xs text-muted">
                      {e.reviewedByName ? `${e.reviewedByName} · ${fmtDateTime(e.reviewedAt)}` : "Chưa có người duyệt"}
                      {e.reviewNote ? ` · “${e.reviewNote}”` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, tone = "text-ink", onClick }: { label: string; value: number | string; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-display text-3xl leading-none font-semibold tabular-nums ${tone}`}>{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-xl border border-edge bg-card p-3 text-left hover:bg-paper">{body}</button>
  ) : (
    <div className="rounded-xl border border-edge bg-card p-3">{body}</div>
  );
}

function Table({ head, empty, children }: { head: string[]; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="max-h-[65dvh] overflow-auto rounded-xl border border-edge bg-card">
      <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}${i}`} className="sticky top-0 z-10 border-b-2 border-ink bg-card px-3 py-2 text-left text-xs font-semibold text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? <p className="p-6 text-sm text-muted">Không có dữ liệu khớp bộ lọc trong khoảng ngày này.</p> : null}
    </div>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2 ${mono ? "font-display text-base tabular-nums" : ""}`}>{children}</td>;
}

function Person({ name, sub }: { name: string; sub: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sand font-display text-base font-semibold">{name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        {sub ? <span className="block truncate text-[11px] text-muted">{sub}</span> : null}
      </span>
    </span>
  );
}
