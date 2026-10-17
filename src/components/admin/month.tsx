import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, LockOpen, Search, X } from "lucide-react";
import { errorText } from "@/components/ui";
import { exportTimesheet, getMonthGrid, lockMonth } from "@/lib/attendance.functions";
import type { MonthGrid } from "@/lib/attendance-types";
import { buildCell, monthDayKeys, summarize, weekdayOf, type CellKind, type DayCell } from "@/lib/month-grid";
import { formatMeters, formatMonthLabel, formatVnDay, minutesToHm, shiftMonth, vnMonthKey, vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { Chip, PunchPhoto } from "./common";

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
  const { data, corrections } = ctx;
  const isAdmin = data.profile.role === "admin";
  const [month, setMonth] = useState(vnMonthKey());
  const [grid, setGrid] = useState<MonthGrid | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<{ userId: string; dateKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const approvedCount = corrections.filter((c) => c.status === "approved").length;

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
  const rows = useMemo(() => {
    if (!grid) return [];
    return grid.people
      .filter((p) => !query || p.fullName.toLowerCase().includes(query.toLowerCase()))
      .map((p) => {
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
            hm: vnTime,
          }),
        );
        return { person: p, cells, sum: summarize(cells) };
      });
  }, [grid, days, query, data.settings.lateMinutes]);

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
  const selCell = sel ? rows.find((r) => r.person.userId === sel.userId)?.cells[days.indexOf(sel.dateKey)] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-4xl font-semibold">Bảng công</h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Tháng trước" className="grid size-10 place-items-center rounded-md border-[1.5px] border-ink bg-card" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft className="size-5" />
          </button>
          <p className="min-w-36 text-center font-display text-2xl font-semibold capitalize">{formatMonthLabel(month)}</p>
          <button type="button" aria-label="Tháng sau" className="grid size-10 place-items-center rounded-md border-[1.5px] border-ink bg-card" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên" className="h-10 w-44 rounded-md border-[1.5px] border-ink bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice" />
        </label>
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
              className="flex h-10 items-center gap-2 rounded-md border-[1.5px] border-ink bg-card px-4 text-sm font-semibold disabled:opacity-40"
              onClick={() => void toggleLock(true)}
            >
              <Lock className="size-4" /> Chốt công
            </button>
          ) : null}
          <button type="button" disabled={busy} className="flex h-10 items-center gap-2 rounded-md bg-ice px-4 text-sm font-semibold shadow-[0_3px_0_var(--color-ink)]" onClick={() => void download()}>
            <Download className="size-4" /> Tải CSV
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <Legend />

      {!grid ? (
        <p className="py-10 text-sm text-muted">Đang tải bảng công…</p>
      ) : (
        <div className="max-h-[70dvh] overflow-auto rounded-lg border-[1.5px] border-ink bg-card">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 min-w-44 border-b-2 border-ink bg-card px-3 py-2 text-left font-semibold">Nhân viên</th>
                {["Công", "Muộn", "Vắng", "Thiếu", "TC"].map((h) => (
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
                  <th className="sticky left-0 z-10 max-w-52 truncate border-b border-line bg-card px-3 py-1.5 text-left font-medium group-hover:bg-paper">{person.fullName}</th>
                  <Num v={sum.days} />
                  <Num v={sum.late} warn />
                  <Num v={sum.absent} bad />
                  <Num v={sum.partial} bad />
                  <td className="border-b border-line px-2 text-center font-display text-base tabular-nums">{sum.overtimeMinutes ? minutesToHm(sum.overtimeMinutes) : "–"}</td>
                  {cells.map((c, i) => (
                    <td key={days[i]} className="border-b border-line p-0.5">
                      <button
                        type="button"
                        onClick={() => setSel({ userId: person.userId, dateKey: days[i] })}
                        title={`${person.fullName} · ${KIND_TEXT[c.kind]}`}
                        className={`relative h-9 w-11 rounded-sm border font-display text-sm font-semibold tabular-nums ${CELL_CLASS[c.kind]}`}
                      >
                        {c.label}
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
            <button type="button" aria-label="Đóng" className="grid size-9 place-items-center rounded-md border-[1.5px] border-ink" onClick={() => setSel(null)}>
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
    </div>
  );
}

function DayChips({ cell }: { cell: DayCell }) {
  const tone = cell.kind === "ok" ? "ok" : cell.kind === "late" ? "late" : cell.kind === "absent" || cell.kind === "partial" ? "clay" : "muted";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Chip tone={tone}>{KIND_TEXT[cell.kind]}</Chip>
      {cell.lateMinutes > 0 ? <Chip tone="late">Muộn {cell.lateMinutes} phút</Chip> : null}
    </div>
  );
}

function Num({ v, warn, bad }: { v: number; warn?: boolean; bad?: boolean }) {
  const cls = v > 0 && bad ? "text-clay" : v > 0 && warn ? "text-ink" : "text-ink";
  return <td className={`border-b border-line px-2 text-center font-display text-base tabular-nums ${cls} ${v === 0 ? "opacity-40" : ""}`}>{v}</td>;
}

function Legend() {
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
    </ul>
  );
}
