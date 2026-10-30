import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { downloadXlsx } from "@/lib/xlsx-lite";
import { timesheetSheets } from "@/lib/timesheet-xlsx";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Lock, LockOpen, Search, X } from "lucide-react";
import { errorText } from "@/components/ui";
import { exportTimesheet, getMonthGrid, lockMonth } from "@/lib/attendance.functions";
import { scheduleOf, type MonthGrid } from "@/lib/attendance-types";
import { buildCell, monthDayKeys, summarize, weekdayOf, type CellKind, type DayCell } from "@/lib/month-grid";
import { formatMeters, formatMonthLabel, formatVnDay, minutesToHm, shiftMonth, vnDateKey, vnMonthKey, vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { compareByCode } from "@/lib/employee-order";
import { Chip, PageHero, PunchPhoto, useClickAway } from "./common";

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const CELL_CLASS: Record<CellKind, string> = {
  ok: "bg-ok/15 text-ok border-ok/30",
  late: "bg-ice text-ink border-ink/30",
  partial: "border-dashed border-clay bg-clay/10 text-clay",
  absent: "bg-clay text-card border-clay",
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

export function MonthView({ ctx }: { ctx: AdminCtx }) {
  const { data, corrections, leaves } = ctx;
  const isAdmin = data.profile.role === "admin";
  const [month, setMonth] = useState(vnMonthKey());
  const [grid, setGrid] = useState<MonthGrid | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [show, setShow] = useState<"cong" | "gio">("cong");
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

  const dayPanelRef = useRef<HTMLElement>(null);
  useClickAway(dayPanelRef, () => setSel(null), sel !== null);
  const days = useMemo(() => monthDayKeys(month), [month]);
  const rates = useMemo(() => ({ sunday: data.settings.sundayRate, holiday: data.settings.holidayRate }), [data.settings.sundayRate, data.settings.holidayRate]);
  const all = useMemo(() => {
    if (!grid) return [];
    return [...grid.people].sort(compareByCode).map((p) => {
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
          extraOvertimeMinutes: grid.extraOt?.[p.userId]?.[d] ?? 0,
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
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(({ person: p, sum }) => p.isActive !== false || sum.congQuyDoi > 0)
      .filter(({ person: p }) => !q || p.fullName.toLowerCase().includes(q) || (p.employeeCode ?? "").toLowerCase().includes(q))
      .filter(({ person: p }) => !dept || (p.department ?? "") === dept);
  }, [all, query, dept]);
  const depts = useMemo(() => [...new Set((grid?.people ?? []).map((p) => p.department ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [grid]);

  const issues = useMemo(() => {
    const partial = all.reduce((n, r) => n + r.sum.partial, 0);
    const pendingReq =
      corrections.filter((c) => c.status === "pending" && c.attendanceDate.startsWith(month)).length +
      leaves.filter((l) => l.status === "pending" && l.leaveDate.startsWith(month)).length +
      data.overtimePending.filter((o) => vnDateKey(o.punchedAt).startsWith(month)).length;
    return { partial, pendingReq };
  }, [all, corrections, leaves, data.overtimePending, month]);
  const totalCong = rows.reduce((n, r) => n + r.sum.congQuyDoi, 0);

  async function download() {
    setBusy(true);
    try {
      const file = await exportTimesheet({ data: month });
      downloadXlsx(`bang-cong-${file.month}.xlsx`, timesheetSheets(file));
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
  const selCell = sel ? rows.find((r) => r.person.userId === sel.userId)?.cells[days.indexOf(sel.dateKey)] : undefined;

  return (
    <div className="space-y-4">
      <PageHero
        title="Bảng công"
        subtitle={
          grid
            ? `${rows.length} nhân viên · tổng ${fmtCong(totalCong)} công quy đổi · công chuẩn ${data.settings.standardDays} (trừ Chủ nhật) · Chủ nhật ×${data.settings.sundayRate} · lễ ×${data.settings.holidayRate}`
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
        <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="group" aria-label="Kiểu hiển thị ô">
          {(["cong", "gio"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`h-9 px-3 ${show === k ? "bg-night text-ice" : "bg-card"}`}>
              {k === "cong" ? "Công" : "Giờ vào"}
            </button>
          ))}
        </div>
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
            <Download className="size-4" /> Tải Excel
          </button>
        </div>
      </div>

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
      <Legend full={data.settings.fullDayMinutes} half={data.settings.halfDayMinutes} />

      {!grid ? (
        <p className="py-10 text-sm text-muted">Đang tải bảng công…</p>
      ) : (
        <div className="max-h-[75dvh] overflow-y-auto overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col style={{ width: "10.5rem" }} />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <col key={i} style={{ width: i === 5 ? "3.25rem" : "2.5rem" }} />
              ))}
              {days.map((d) => (
                <col key={d} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 border-b-2 border-ink bg-card px-3 py-2 text-left font-semibold">Nhân viên</th>
                {["Công", "Muộn", "Vắng", "Thiếu", "Nghỉ", "TC"].map((h) => (
                  <th key={h} className="sticky top-0 z-10 border-b-2 border-ink bg-card px-0 py-2 text-center text-[11px] font-semibold text-muted">
                    {h}
                  </th>
                ))}
                {days.map((d) => (
                  <th key={d} className={`sticky top-0 z-10 border-b-2 border-ink px-0 py-1 text-center font-display text-xs font-semibold ${weekdayOf(d) === 0 ? "bg-sand" : "bg-card"} ${d === grid.todayKey ? "text-clay" : ""}`}>
                    <span className="block text-[10px] font-normal text-muted">{WEEKDAY[weekdayOf(d)]}</span>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ person, cells, sum }) => (
                <tr key={person.userId} className="group">
                  <th className="sticky left-0 z-10 overflow-hidden border-b border-line bg-card px-2 py-1.5 text-left font-medium group-hover:bg-paper">
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
                  <td className="border-b border-line px-0 text-center font-display text-xs tabular-nums">{sum.overtimeMinutes ? minutesToHm(sum.overtimeMinutes) : "–"}</td>
                  {cells.map((c, i) => (
                    <td key={days[i]} className="border-b border-line p-px">
                      <button
                        type="button"
                        onClick={() => setSel({ userId: person.userId, dateKey: days[i] })}
                        title={`${person.fullName} · ${KIND_TEXT[c.kind]}${c.cong != null ? ` · ${c.cong} công` : ""}${c.workedMinutes ? ` · làm ${minutesToHm(c.workedMinutes)}` : ""}`}
                        className={`relative h-10 w-full min-w-0 rounded-sm border px-0 font-display text-xs leading-none font-semibold tabular-nums ${CELL_CLASS[c.kind]}`}
                      >
                        <CellLabel text={cellText(c, show)} />
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
        <aside ref={dayPanelRef} className="fixed inset-y-0 right-0 z-30 w-full overflow-y-auto border-l-2 border-ink bg-card p-5 shadow-2xl sm:w-[26rem]" aria-label="Chi tiết ngày">
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
          cells={rows.find((r) => r.person.userId === personId)?.cells ?? []}
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
    .filter((x) => (x.c.overtimeMinutes > 0 && x.c.overtimeStatus === "approved") || x.c.extraOvertimeMinutes > 0);
  const absentDays = cells
    .map((c, i) => ({ c, d: days[i] }))
    .filter((x) => x.c.kind === "absent");
  const sum = summarize(cells, rates);
  return (
    <aside className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
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
            <DayLine key={d} date={d} text={minutesToHm((c.overtimeStatus === "approved" ? c.overtimeMinutes : 0) + c.extraOvertimeMinutes) + (c.extraOvertimeMinutes ? ` (gồm ${minutesToHm(c.extraOvertimeMinutes)} theo đơn)` : "")} onClick={() => onPickDay(d)} />
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

/** Giờ vào hiển thị xếp dọc (giờ trên, phút dưới) để ô hẹp vẫn đọc được, không phải kéo thanh trượt. */
function CellLabel({ text }: { text: string }) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <span className="flex flex-col items-center leading-[1.1]">
      <span>{Number(m[1])}</span>
      <span className="text-[10px] font-medium opacity-80">{m[2]}</span>
    </span>
  );
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
  return <td className={`border-b border-line px-0 text-center font-display text-sm tabular-nums ${cls} ${strong ? "font-bold" : ""} ${v === 0 ? "opacity-40" : ""}`}>{fmtCong(v)}</td>;
}

function Legend({ full, half }: { full: number; half: number }) {
  const items: [CellKind, string][] = [
    ["ok", "Đủ công"],
    ["late", "Đi muộn"],
    ["partial", "Thiếu giờ vào/ra"],
    ["absent", "Vắng"],
    ["off", "Nghỉ"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([k, t]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={`size-4 rounded-sm border ${CELL_CLASS[k]}`} /> {t}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-clay" /> Chấm ngoài vùng
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-ink" /> Có tăng ca đã duyệt
      </li>
      <li>V vắng · ! thiếu giờ ra · P phép · Ố ốm · T thai sản · L lễ (nghỉ lễ không tính công)</li>
      <li>Làm Chủ nhật/lễ chỉ tính công khi tăng ca được duyệt, rồi nhân hệ số</li>
      <li>
        1 công từ {minutesToHm(full)} làm · 0.5 công từ {minutesToHm(half)}
      </li>
    </ul>
  );
}
