import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, Lock, LockOpen, Search, X } from "lucide-react";
import { errorText } from "@/components/ui";
import { exportTimesheet, getMonthGrid, lockMonth } from "@/lib/attendance.functions";
import { scheduleOf, type MonthGrid } from "@/lib/attendance-types";
import { buildCell, monthDayKeys, summarize, weekdayOf, type CellKind, type DayCell, type PersonSummary } from "@/lib/month-grid";
import { formatMeters, formatMonthLabel, formatVnDay, minutesToHm, shiftMonth, vnDateKey, vnMonthKey, vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { Chip, PageHero, PunchPhoto } from "./common";

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const CELL_CLASS: Record<CellKind, string> = {
  ok: "bg-ok/15 text-ok border-ok/30",
  late: "bg-ice text-ink border-ink/30",
  partial: "border-clay bg-clay text-card",
  absent: "border-clay/30 bg-clay/15 text-clay/70",
  off: "border-transparent bg-sand/50",
  future: "border-transparent",
};

const KIND_TEXT: Record<CellKind, string> = {
  ok: "Đủ công",
  late: "Đi muộn",
  partial: "Thiếu giờ vào hoặc ra",
  absent: "Vắng",
  off: "Nghỉ",
  future: "Chưa tới",
};

type ViewMode = "tong" | "luoi";
type RowFilter = "all" | "todo" | "late" | "abs";
type SortKey = "todo" | "name" | "cong";

/** Ô trong dải tổng quan: chỉ "thiếu giờ" (cần xử lý) mới đỏ đậm, "vắng" chỉ đỏ nhạt. */
const TICK_CLASS: Record<CellKind, string> = {
  ok: "bg-ok/30",
  late: "bg-ice",
  partial: "bg-clay",
  absent: "bg-clay/20",
  off: "border border-line",
  future: "border border-dashed border-line/70",
};
/** Vạch chéo để phân biệt "thiếu giờ" bằng hình dạng, không chỉ bằng màu. */
const STRIPES = "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.5) 0 2px, transparent 2px 4px)";
const OFF_LABEL_TEXT: Record<string, string> = { P: "Nghỉ phép", "Ố": "Nghỉ ốm", T: "Thai sản", L: "Nghỉ lễ" };

function kindText(c: DayCell): string {
  return c.kind === "off" && c.label ? (OFF_LABEL_TEXT[c.label] ?? "Nghỉ") : KIND_TEXT[c.kind];
}

export function MonthView({ ctx }: { ctx: AdminCtx }) {
  const { data, corrections, leaves } = ctx;
  const isAdmin = data.profile.role === "admin";
  const [month, setMonth] = useState(vnMonthKey());
  const [grid, setGrid] = useState<MonthGrid | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [show, setShow] = useState<"cong" | "gio">("cong");
  const [view, setView] = useState<ViewMode>("tong");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("todo");
  const [focus, setFocus] = useState<CellKind | null>(null);
  const [sel, setSel] = useState<{ userId: string; dateKey: string } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approvedCount = corrections.filter((c) => c.status === "approved").length + leaves.filter((l) => l.status === "approved").length;

  const load = useCallback(async () => {
    try {
      setGrid(await getMonthGrid({ data: month }));
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [month]);

  useEffect(() => {
    setGrid(null);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load, approvedCount, data.overtimePending.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const days = useMemo(() => monthDayKeys(month), [month]);
  const rates = useMemo(() => ({ sunday: data.settings.sundayRate, holiday: data.settings.holidayRate }), [data.settings.sundayRate, data.settings.holidayRate]);
  const all = useMemo(() => {
    if (!grid) return [];
    return grid.people.map((p) => {
      const cells = days.map((d) =>
        buildCell({
          dateKey: d,
          punches: grid.punches[p.userId]?.[d] ?? [],
          todayKey: grid.todayKey,
          startedOn: p.startedOn,
          endedOn: p.endedOn,
          isHoliday: grid.holidays?.includes(d) ?? false,
          hasApprovedLeave: !!grid.leaves?.[p.userId]?.[d],
          leaveKind: grid.leaves?.[p.userId]?.[d] ?? null,
          lateThreshold: data.settings.lateMinutes,
          schedule: scheduleOf(data.settings),
          fullDayMinutes: data.settings.fullDayMinutes,
          halfDayMinutes: data.settings.halfDayMinutes,
          hm: vnTime,
        }),
      );
      return { person: p, cells, sum: summarize(cells, rates) };
    });
  }, [grid, days, rates, data.settings]);
  // Số đơn đang chờ duyệt của từng người trong tháng đang xem
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string | undefined) => {
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    };
    corrections.filter((c) => c.status === "pending" && c.attendanceDate.startsWith(month)).forEach((c) => add(c.userId));
    leaves.filter((l) => l.status === "pending" && l.leaveDate.startsWith(month)).forEach((l) => add(l.userId));
    data.overtimePending.filter((o) => vnDateKey(o.punchedAt).startsWith(month)).forEach((o) => add(o.userId));
    return m;
  }, [corrections, leaves, data.overtimePending, month]);
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(({ person: p, sum }) => p.isActive !== false || sum.congQuyDoi > 0)
      .filter(({ person: p }) => !q || p.fullName.toLowerCase().includes(q) || (p.employeeCode ?? "").toLowerCase().includes(q))
      .filter(({ person: p }) => !dept || (p.department ?? "") === dept)
      .map((r) => {
        const pending = pendingBy.get(r.person.userId) ?? 0;
        // "Cần xử lý" = ngày thiếu giờ vào/ra + đơn chờ duyệt. Vắng không tính: có thể là bình thường.
        return { ...r, pending, todo: r.sum.partial + pending };
      });
  }, [all, query, dept, pendingBy]);
  const counts = useMemo(
    () => ({
      all: base.length,
      todo: base.filter((r) => r.todo > 0).length,
      late: base.filter((r) => r.sum.late > 0).length,
      abs: base.filter((r) => r.sum.absent > 0).length,
    }),
    [base],
  );
  const rows = useMemo(() => {
    const keep = base.filter((r) => filter === "all" || (filter === "todo" && r.todo > 0) || (filter === "late" && r.sum.late > 0) || (filter === "abs" && r.sum.absent > 0));
    const byName = (x: (typeof base)[number], y: (typeof base)[number]) => x.person.fullName.localeCompare(y.person.fullName, "vi");
    return [...keep].sort((x, y) => {
      if (sortKey === "name") return byName(x, y);
      if (sortKey === "cong") return y.sum.congQuyDoi - x.sum.congQuyDoi || byName(x, y);
      return y.todo - x.todo || y.sum.late - x.sum.late || y.sum.absent - x.sum.absent || byName(x, y);
    });
  }, [base, filter, sortKey]);
  const depts = useMemo(() => [...new Set((grid?.people ?? []).map((p) => p.department ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [grid]);

  const issues = useMemo(() => {
    const partial = all.reduce((n, r) => n + r.sum.partial, 0);
    const pendingReq =
      corrections.filter((c) => c.status === "pending" && c.attendanceDate.startsWith(month)).length +
      leaves.filter((l) => l.status === "pending" && l.leaveDate.startsWith(month)).length +
      data.overtimePending.filter((o) => vnDateKey(o.punchedAt).startsWith(month)).length;
    return { partial, pendingReq };
  }, [all, corrections, leaves, data.overtimePending, month]);
  const totalCong = base.reduce((n, r) => n + r.sum.congQuyDoi, 0);

  async function download() {
    setBusy(true);
    try {
      const file = await exportTimesheet({ data: month });
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  async function toggleLock(locked: boolean) {
    const text = locked
      ? `Chốt công ${formatMonthLabel(month)}? Sau khi chốt, không duyệt thêm đơn sửa công hoặc tăng ca của tháng này (quản trị vẫn mở khóa được).`
      : `Mở khóa ${formatMonthLabel(month)} để tiếp tục sửa?`;
    if (!window.confirm(text)) return;
    setBusy(true);
    try {
      await lockMonth({ data: { month, locked } });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  const canLock = month < vnMonthKey();
  const selPerson = sel && grid ? grid.people.find((p) => p.userId === sel.userId) : undefined;
  const selPunches = sel && grid ? (grid.punches[sel.userId]?.[sel.dateKey] ?? []) : [];
  const selCell = sel ? all.find((r) => r.person.userId === sel.userId)?.cells[days.indexOf(sel.dateKey)] : undefined;

  return (
    <div className="space-y-4">
      <PageHero
        title="Bảng công"
        subtitle={
          grid
            ? `${base.length} nhân viên · tổng ${fmtCong(totalCong)} công quy đổi · công chuẩn ${data.settings.standardDays} (trừ Chủ nhật) · Chủ nhật ×${data.settings.sundayRate} · lễ ×${data.settings.holidayRate}`
            : "Đang tải…"
        }
        actions={
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Tháng trước" className="grid size-10 place-items-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <ChevronLeft className="size-5" />
            </button>
            <p className="min-w-36 text-center font-display text-2xl font-bold capitalize">{formatMonthLabel(month)}</p>
            <button type="button" aria-label="Tháng sau" className="grid size-10 place-items-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên hoặc mã NV" className="h-10 w-44 rounded-md border border-edge bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice" />
        </label>
        {depts.length ? (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Lọc theo phòng ban" className="h-10 rounded-md border border-edge bg-card px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice">
            <option value="">Tất cả phòng ban</option>
            {depts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        ) : null}
        <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="group" aria-label="Kiểu xem bảng công">
          {([["tong", "Tổng quan"], ["luoi", "Lưới ngày"]] as const).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`h-9 px-3 ${view === k ? "bg-night text-ice" : "bg-card"}`}>
              {t}
            </button>
          ))}
        </div>
        {view === "luoi" ? (
          <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="group" aria-label="Kiểu hiển thị ô">
            {(["cong", "gio"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`h-9 px-3 ${show === k ? "bg-night text-ice" : "bg-card"}`}>
                {k === "cong" ? "Công" : "Giờ vào"}
              </button>
            ))}
          </div>
        ) : null}
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sắp xếp" className="h-10 rounded-md border border-edge bg-card px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice">
          <option value="todo">Cần xử lý trước</option>
          <option value="name">Tên A–Z</option>
          <option value="cong">Công nhiều nhất</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {grid?.lock ? (
            <>
              <Chip tone="ink">
                <Lock className="mr-1 size-3" /> Đã chốt
              </Chip>
              <span className="text-xs text-muted">
                {grid.lock.lockedByName} · {new Date(grid.lock.lockedAt).toLocaleDateString("vi-VN")}
              </span>
              {isAdmin ? (
                <button type="button" disabled={busy} className="flex items-center gap-1 text-sm font-semibold underline" onClick={() => void toggleLock(false)}>
                  <LockOpen className="size-4" /> Mở khóa
                </button>
              ) : null}
            </>
          ) : isAdmin ? (
            <button
              type="button"
              disabled={busy || !canLock}
              title={canLock ? "" : "Chỉ chốt được tháng đã kết thúc"}
              className="flex h-10 items-center gap-2 rounded-md border border-edge bg-card px-4 text-sm font-semibold disabled:opacity-40"
              onClick={() => void toggleLock(true)}
            >
              <Lock className="size-4" /> Chốt công
            </button>
          ) : null}
          <button type="button" disabled={busy} className="flex h-10 items-center gap-2 rounded-lg bg-ice px-4 text-sm font-bold text-night" onClick={() => void download()}>
            <Download className="size-4" /> Tải CSV
          </button>
        </div>
      </div>

      {grid ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lọc nhanh">
          {([["all", "Tất cả"], ["todo", "Cần xử lý"], ["late", "Đi muộn"], ["abs", "Vắng"]] as const).map(([k, t]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${filter === k ? "border-night bg-night text-ice" : "border-edge bg-card"}`}
            >
              {t}
              <span className={`tabular-nums ${filter !== k && k === "todo" && counts.todo > 0 ? "text-clay" : "opacity-70"}`}>{counts[k]}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {grid && !grid.lock && (issues.partial > 0 || issues.pendingReq > 0) ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border-[1.5px] border-clay bg-clay/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-clay" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Còn việc cần xử lý trước khi chốt công {formatMonthLabel(month)}:</span>{" "}
            {[issues.partial ? `${issues.partial} ngày thiếu giờ vào hoặc ra` : "", issues.pendingReq ? `${issues.pendingReq} đơn chưa duyệt` : ""].filter(Boolean).join(", ")}.
          </p>
          {issues.pendingReq ? (
            <button type="button" className="font-semibold underline" onClick={() => ctx.go("inbox")}>
              Mở Cần duyệt
            </button>
          ) : null}
        </div>
      ) : null}
      <Legend full={data.settings.fullDayMinutes} half={data.settings.halfDayMinutes} focus={focus} onFocus={setFocus} showCodes={view === "luoi"} />

      {!grid ? (
        <p className="py-10 text-sm text-muted">Đang tải bảng công…</p>
      ) : view === "tong" ? (
        <OverviewList
          rows={rows}
          days={days}
          todayKey={grid.todayKey}
          focus={focus}
          onPickDay={(userId, dateKey) => setSel({ userId, dateKey })}
          onPickPerson={setPersonId}
        />
      ) : (
        <div className="max-h-[70dvh] overflow-auto rounded-xl border border-edge bg-card">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 min-w-44 border-b-2 border-ink bg-card px-3 py-2 text-left font-semibold">Nhân viên</th>
                {["Công", "Muộn", "Vắng", "Thiếu", "Nghỉ", "TC"].map((h) => (
                  <th key={h} className="sticky top-0 z-10 border-b-2 border-ink bg-card px-2 py-2 text-center text-xs font-semibold text-muted">
                    {h}
                  </th>
                ))}
                {days.map((d) => (
                  <th key={d} className={`sticky top-0 z-10 border-b-2 border-ink px-0.5 py-1 text-center font-display text-sm font-semibold ${weekdayOf(d) === 0 ? "bg-sand" : "bg-card"} ${d === grid.todayKey ? "text-clay" : ""}`}>
                    <span className="block text-[10px] font-normal text-muted">{WEEKDAY[weekdayOf(d)]}</span>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ person, cells, sum }) => (
                <tr key={person.userId} className="group">
                  <th className="sticky left-0 z-10 max-w-52 truncate border-b border-line bg-card px-3 py-1.5 text-left font-medium group-hover:bg-paper">
                    <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setPersonId(person.userId)}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sand font-display text-base font-semibold">{person.fullName.charAt(0).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className={`block truncate ${person.isActive === false ? "text-muted line-through" : ""}`}>{person.fullName}</span>
                        <span className="block truncate text-[11px] font-normal text-muted">{[person.employeeCode, person.department].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                    </button>
                  </th>
                  <Num v={sum.congQuyDoi} strong />
                  <Num v={sum.late} warn />
                  <Num v={sum.absent} bad />
                  <Num v={sum.partial} bad />
                  <Num v={sum.leave + sum.holiday} />
                  <td className="border-b border-line px-2 text-center font-display text-base tabular-nums">{sum.overtimeMinutes ? minutesToHm(sum.overtimeMinutes) : "–"}</td>
                  {cells.map((c, i) => (
                    <td key={days[i]} className="border-b border-line p-0.5">
                      <button
                        type="button"
                        onClick={() => setSel({ userId: person.userId, dateKey: days[i] })}
                        title={`${person.fullName} · ${KIND_TEXT[c.kind]}${c.cong != null ? ` · ${c.cong} công` : ""}${c.workedMinutes ? ` · làm ${minutesToHm(c.workedMinutes)}` : ""}`}
                        className={`relative h-9 w-11 rounded-sm border font-display text-sm font-semibold tabular-nums ${CELL_CLASS[c.kind]} ${focus && c.kind !== focus ? "opacity-20" : ""}`}
                      >
                        {cellText(c, show)}
                        {c.offsite ? <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-clay ring-1 ring-card" /> : null}
                        {c.overtimeStatus === "approved" ? <span className="absolute right-1 bottom-0.5 left-1 h-0.5 bg-ink" /> : null}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="p-6 text-sm text-muted">Không có nhân viên khớp.</p> : null}
        </div>
      )}

      {sel && selPerson ? (
        <aside className="fixed inset-y-0 right-0 z-30 w-full overflow-y-auto border-l-2 border-ink bg-card p-5 shadow-2xl sm:w-[26rem]" aria-label="Chi tiết ngày">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-3xl font-semibold">{selPerson.fullName}</p>
              <p className="text-sm text-muted">{formatVnDay(sel.dateKey)}</p>
            </div>
            <button type="button" aria-label="Đóng" className="grid size-9 place-items-center rounded-md border border-edge" onClick={() => setSel(null)}>
              <X className="size-5" />
            </button>
          </div>
          {selCell ? <DayChips cell={selCell} /> : null}
          {selPunches.length === 0 ? (
            <p className="mt-6 text-sm text-muted">Không có lượt chấm nào trong ngày này.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {selPunches.map((p) => (
                <li key={p.id} className="space-y-2 border-l-4 border-ink pl-3">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-4xl leading-none font-semibold tabular-nums">{vnTime(p.at)}</span>
                    <Chip tone={p.type === "in" ? "ok" : "ink"}>{p.type === "in" ? "VÀO" : "RA"}</Chip>
                    {p.status === "corrected" ? <Chip tone="muted">Theo đơn</Chip> : null}
                    {p.offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
                  </div>
                  <p className="text-sm text-muted">
                    {p.nearestName ?? "Không rõ địa điểm"}
                    {p.distanceMeters != null ? ` · cách ${formatMeters(p.distanceMeters)}` : ""}
                    {p.lateMinutes > 0 ? ` · muộn ${p.lateMinutes} phút` : ""}
                    {p.overtimeMinutes > 0 ? ` · tăng ca ${minutesToHm(p.overtimeMinutes)} (${{ approved: "đã duyệt", pending: "chờ duyệt", rejected: "từ chối", none: "chưa tính" }[p.overtimeStatus]})` : ""}
                  </p>
                  {p.hasPhoto ? <PunchPhoto id={p.id} /> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-8 text-xs text-muted">Cần sửa giờ? Nhân viên gửi đơn sửa công, bạn duyệt trong mục "Cần duyệt". Mọi chỉnh sửa đều có dấu vết.</p>
        </aside>
      ) : null}
      {personId && grid ? (
        <PersonDetail
          person={grid.people.find((p) => p.userId === personId)}
          days={days}
          cells={all.find((r) => r.person.userId === personId)?.cells ?? []}
          rates={rates}
          onClose={() => setPersonId(null)}
          onPickDay={(dateKey) => {
            setSel({ userId: personId, dateKey });
            setPersonId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PersonDetail({
  person,
  days,
  cells,
  rates,
  onClose,
  onPickDay,
}: {
  person: MonthGrid["people"][number] | undefined;
  days: string[];
  cells: DayCell[];
  rates: { sunday: number; holiday: number };
  onClose: () => void;
  onPickDay: (dateKey: string) => void;
}) {
  if (!person) return null;
  const lateDays = cells
    .map((c, i) => ({ c, d: days[i] }))
    .filter((x) => x.c.kind === "late");
  const otDays = cells
    .map((c, i) => ({ c, d: days[i] }))
    .filter((x) => x.c.overtimeMinutes > 0 && x.c.overtimeStatus === "approved");
  const absentDays = cells
    .map((c, i) => ({ c, d: days[i] }))
    .filter((x) => x.c.kind === "absent");
  const sum = summarize(cells, rates);
  return (
    <aside className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-card p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-3xl font-bold">{person.fullName}</p>
            <p className="text-sm text-muted">{[person.employeeCode, person.department].filter(Boolean).join(" · ") || "Nhân viên"}</p>
          </div>
          <button type="button" aria-label="Đóng" className="grid size-9 place-items-center rounded-md border border-edge" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2 text-center">
          <Stat label="Công quy đổi" value={fmtCong(sum.congQuyDoi)} />
          <Stat label="Muộn" value={String(sum.late)} />
          <Stat label="Vắng" value={String(sum.absent)} />
          <Stat label="Nghỉ" value={String(sum.leave + sum.holiday)} />
          <Stat label="Tăng ca" value={sum.overtimeMinutes ? minutesToHm(sum.overtimeMinutes) : "–"} />
        </div>
        {sum.sundayCong || sum.holidayCong || sum.premiumPending ? (
          <p className="mt-3 rounded-md bg-sand px-3 py-2 text-xs">
            Công thường {fmtCong(sum.cong)}
            {sum.sundayCong ? ` · Chủ nhật ${fmtCong(sum.sundayCong)} ×${rates.sunday}` : ""}
            {sum.holidayCong ? ` · lễ ${fmtCong(sum.holidayCong)} ×${rates.holiday}` : ""}
            {sum.premiumPending ? ` · ${sum.premiumPending} ngày Chủ nhật/lễ chờ duyệt tăng ca, chưa tính` : ""}
          </p>
        ) : null}
        <Section title={`Ngày đi muộn (${lateDays.length})`}>
          {lateDays.length === 0 ? <Empty /> : lateDays.map(({ c, d }) => (
            <DayLine key={d} date={d} text={`Muộn ${c.lateMinutes} phút · vào ${c.firstIn ? vnTime(c.firstIn) : "?"}`} onClick={() => onPickDay(d)} />
          ))}
        </Section>
        <Section title={`Ngày tăng ca đã duyệt (${otDays.length})`}>
          {otDays.length === 0 ? <Empty /> : otDays.map(({ c, d }) => (
            <DayLine key={d} date={d} text={minutesToHm(c.overtimeMinutes)} onClick={() => onPickDay(d)} />
          ))}
        </Section>
        <Section title={`Ngày vắng (${absentDays.length})`}>
          {absentDays.length === 0 ? <Empty /> : absentDays.map(({ d }) => (
            <DayLine key={d} date={d} text="Vắng" onClick={() => onPickDay(d)} />
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-2 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

function DayLine({ date, text, onClick }: { date: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between rounded-md border border-line bg-paper px-3 py-2 text-left text-sm">
      <span>{formatVnDay(date)}</span>
      <span className="text-muted">{text}</span>
    </button>
  );
}

function Empty() {
  return <p className="text-sm text-muted">Không có.</p>;
}

function cellText(c: DayCell, show: "cong" | "gio"): string {
  if (show === "gio" || c.kind === "off" || c.kind === "future" || c.kind === "absent") return c.label;
  if (c.kind === "partial") return "!";
  return c.cong == null ? "…" : fmtCong(c.cong);
}

function fmtCong(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function DayChips({ cell }: { cell: DayCell }) {
  const tone = cell.kind === "ok" ? "ok" : cell.kind === "late" ? "late" : cell.kind === "absent" || cell.kind === "partial" ? "clay" : "muted";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Chip tone={tone}>{KIND_TEXT[cell.kind]}</Chip>
      {cell.cong != null && cell.kind !== "absent" ? <Chip tone="ink">{fmtCong(cell.cong)} công</Chip> : null}
      {cell.workedMinutes > 0 ? <Chip tone="muted">Làm {minutesToHm(cell.workedMinutes)}</Chip> : null}
      {cell.lateMinutes > 0 ? <Chip tone="late">Muộn {cell.lateMinutes} phút</Chip> : null}
    </div>
  );
}

function Num({ v, warn, bad, strong }: { v: number; warn?: boolean; bad?: boolean; strong?: boolean }) {
  const cls = v > 0 && bad ? "text-clay" : v > 0 && warn ? "text-ink" : "text-ink";
  return <td className={`border-b border-line px-2 text-center font-display text-base tabular-nums ${cls} ${strong ? "font-bold" : ""} ${v === 0 ? "opacity-40" : ""}`}>{fmtCong(v)}</td>;
}

function Legend({
  full,
  half,
  focus,
  onFocus,
  showCodes,
}: {
  full: number;
  half: number;
  focus: CellKind | null;
  onFocus: (k: CellKind | null) => void;
  showCodes: boolean;
}) {
  const items: [CellKind, string][] = [
    ["ok", "Đủ công"],
    ["late", "Đi muộn"],
    ["partial", "Thiếu giờ vào/ra"],
    ["absent", "Vắng"],
    ["off", "Nghỉ"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      {items.map(([k, t]) => (
        <li key={k}>
          <button
            type="button"
            aria-pressed={focus === k}
            onClick={() => onFocus(focus === k ? null : k)}
            title={focus === k ? "Bấm để bỏ làm nổi" : "Bấm để chỉ làm nổi trạng thái này"}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${focus === k ? "bg-night text-card" : "hover:bg-sand"}`}
          >
            <span className={`size-4 rounded-sm border ${CELL_CLASS[k]}`} style={k === "partial" ? { backgroundImage: STRIPES } : undefined} /> {t}
          </button>
        </li>
      ))}
      <li className="flex items-center gap-1.5 px-1">
        <span className="size-2 rounded-full bg-clay" /> Chấm ngoài vùng
      </li>
      <li className="flex items-center gap-1.5 px-1">
        <span className="h-0.5 w-4 bg-ink" /> Có tăng ca đã duyệt
      </li>
      {focus === null ? <li className="px-1">Bấm vào một trạng thái để làm nổi nó</li> : null}
      {showCodes ? <li className="px-1">V vắng · ! thiếu giờ ra · P phép · Ố ốm · T thai sản · L lễ (nghỉ lễ ngày thường vẫn tính 1 công)</li> : null}
      <li className="px-1">Làm Chủ nhật/lễ chỉ tính công khi tăng ca được duyệt, rồi nhân hệ số</li>
      <li className="px-1">
        1 công từ {minutesToHm(full)} làm · 0.5 công từ {minutesToHm(half)}
      </li>
    </ul>
  );
}

type OverviewRow = {
  person: MonthGrid["people"][number];
  cells: DayCell[];
  sum: PersonSummary;
  pending: number;
  todo: number;
};

/** Tổng quan: mỗi người một hàng, cả tháng là một dải ô nhỏ; bấm ô xem ngày, bấm tên xem người. */
function OverviewList({
  rows,
  days,
  todayKey,
  focus,
  onPickDay,
  onPickPerson,
}: {
  rows: OverviewRow[];
  days: string[];
  todayKey: string;
  focus: CellKind | null;
  onPickDay: (userId: string, dateKey: string) => void;
  onPickPerson: (userId: string) => void;
}) {
  const cols = "grid grid-cols-[minmax(10rem,13rem)_minmax(17rem,1fr)_3rem_3rem_3rem_4.25rem] items-center gap-3";
  const showLabel = (d: string) => {
    const n = Number(d.slice(8));
    return n === 1 || n % 5 === 0 || d === todayKey;
  };
  return (
    <div className="max-h-[70dvh] overflow-auto rounded-xl border border-edge bg-card">
      <div className="min-w-[46rem]">
        <div className={`${cols} sticky top-0 z-10 border-b-2 border-ink bg-card px-3 py-2 text-xs font-semibold text-muted`}>
          <span>Nhân viên</span>
          <div className="flex gap-[2px]" aria-hidden="true">
            {days.map((d) => (
              <span key={d} className={`relative h-3 min-w-0 flex-1 text-[10px] leading-3 ${d === todayKey ? "font-bold text-clay" : ""}`}>
                {showLabel(d) ? <span className="absolute left-1/2 -translate-x-1/2">{Number(d.slice(8))}</span> : null}
              </span>
            ))}
          </div>
          <span className="text-right">Công</span>
          <span className="text-right">Muộn</span>
          <span className="text-right">Vắng</span>
          <span className="text-right">Xử lý</span>
        </div>
        {rows.map(({ person, cells, sum, pending, todo }) => {
          const calm = todo === 0 && sum.late === 0 && sum.absent === 0;
          const todoText = [sum.partial ? `${sum.partial} ngày thiếu giờ` : "", pending ? `${pending} đơn chờ duyệt` : ""].filter(Boolean).join(" · ");
          return (
            <div key={person.userId} className={`${cols} border-b border-line px-3 py-2 hover:bg-paper ${calm ? "opacity-70 hover:opacity-100" : ""}`}>
              <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => onPickPerson(person.userId)}>
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sand font-display text-base font-semibold">{person.fullName.charAt(0).toUpperCase()}</span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-medium ${person.isActive === false ? "text-muted line-through" : ""}`}>{person.fullName}</span>
                  <span className="block truncate text-[11px] text-muted">{[person.employeeCode, person.department].filter(Boolean).join(" · ") || "—"}</span>
                </span>
              </button>
              <div className="flex gap-[2px]">
                {cells.map((c, i) => {
                  const d = days[i];
                  const label = `${person.fullName} · ${formatVnDay(d)} · ${kindText(c)}${c.cong != null && c.kind !== "absent" ? ` · ${c.cong} công` : ""}${c.workedMinutes ? ` · làm ${minutesToHm(c.workedMinutes)}` : ""}${c.lateMinutes > 0 && c.kind === "late" ? ` · muộn ${c.lateMinutes} phút` : ""}`;
                  const tone = c.kind === "off" && c.label ? "border border-edge bg-sand" : TICK_CLASS[c.kind];
                  return (
                    <button
                      key={d}
                      type="button"
                      title={label}
                      aria-label={label}
                      onClick={() => onPickDay(person.userId, d)}
                      style={c.kind === "partial" ? { backgroundImage: STRIPES } : undefined}
                      className={`relative h-6 min-w-0 flex-1 rounded-[3px] hover:ring-2 hover:ring-ink/60 focus-visible:ring-2 focus-visible:ring-ink ${tone} ${d === todayKey ? "ring-1 ring-ink" : ""} ${focus && c.kind !== focus ? "opacity-20" : ""}`}
                    >
                      {c.offsite ? <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-clay ring-1 ring-card" /> : null}
                      {c.overtimeStatus === "approved" ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-b-[3px] bg-ink" /> : null}
                    </button>
                  );
                })}
              </div>
              <span className="text-right font-display text-base font-bold tabular-nums">{fmtCong(sum.congQuyDoi)}</span>
              <span className={`text-right font-display text-base tabular-nums ${sum.late ? "" : "text-muted opacity-50"}`}>{sum.late || "–"}</span>
              <span className={`text-right font-display text-base tabular-nums ${sum.absent ? "text-clay" : "text-muted opacity-50"}`}>{sum.absent || "–"}</span>
              <span className="flex justify-end">
                {todo > 0 ? (
                  <button type="button" title={todoText} aria-label={`Cần xử lý: ${todoText}`} onClick={() => onPickPerson(person.userId)} className="rounded-full bg-clay px-2.5 py-0.5 text-xs font-bold text-card tabular-nums">
                    {todo}
                  </button>
                ) : (
                  <Check className="size-4 text-ok" aria-label="Không có việc cần xử lý" />
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 ? <p className="p-6 text-sm text-muted">Không có nhân viên khớp.</p> : null}
      </div>
    </div>
  );
}
