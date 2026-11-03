import type { ReactNode } from "react";
import type { MonthGrid } from "@/lib/attendance-types";
import { hmToMinutes, minutesToHm, vnMinutes, vnTime } from "@/lib/vn-time";
import { weekdayOf, type DayCell, type MonthPunch } from "@/lib/month-grid";
import { Chip } from "./common";

/** Xem tất cả giờ vào ra của mọi nhân viên trong MỘT ngày (dùng trong màn Bảng công). */

export type DayFilter = "all" | "ok" | "late" | "partial" | "absent" | "off" | "waiting" | "offsite";

export type DayItem = {
  person: MonthGrid["people"][number];
  cell: DayCell;
  punches: MonthPunch[];
  /** Trạng thái dùng để lọc và hiển thị. */
  state: Exclude<DayFilter, "all" | "offsite">;
  label: string;
  /** Vào ca chiều (nghỉ sáng): lần vào đầu từ giờ nghỉ trưa trở đi. */
  afternoon: boolean;
};

const WEEKDAY_LONG = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const LEAVE_TEXT: Record<string, string> = { P: "Nghỉ phép", "Ố": "Nghỉ ốm", T: "Thai sản", L: "Ngày lễ" };

export const DAY_FILTERS: [DayFilter, string][] = [
  ["all", "Tất cả"],
  ["ok", "Đủ công"],
  ["late", "Đi muộn"],
  ["partial", "Thiếu giờ vào/ra"],
  ["absent", "Vắng"],
  ["off", "Nghỉ"],
  ["waiting", "Chưa chấm"],
  ["offsite", "Ngoài vùng"],
];

export function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function dayTitle(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${WEEKDAY_LONG[weekdayOf(dateKey)]}, ${d}/${m}/${y}`;
}

/** Ghép dữ liệu một ngày cho từng người; bỏ những người không thuộc ngày đó (chưa vào làm, đã nghỉ việc, Chủ nhật không đi làm). */
export function buildDayItems(
  rows: { person: MonthGrid["people"][number]; cells: DayCell[] }[],
  grid: MonthGrid,
  days: string[],
  day: string,
  lunchStart: string,
): DayItem[] {
  const idx = days.indexOf(day);
  if (idx < 0) return [];
  const lunch = hmToMinutes(lunchStart);
  const out: DayItem[] = [];
  for (const { person, cells } of rows) {
    const cell = cells[idx];
    if (!cell) continue;
    if (cell.kind === "off" && !cell.label) continue;
    let state: DayItem["state"];
    let label: string;
    if (cell.kind === "future") {
      if (day !== grid.todayKey) continue;
      state = "waiting";
      label = "Chưa chấm";
    } else if (cell.kind === "off") {
      state = "off";
      label = LEAVE_TEXT[cell.label] ?? "Nghỉ";
    } else if (cell.kind === "partial") {
      state = "partial";
      label = "Thiếu giờ vào/ra";
    } else if (cell.kind === "absent") {
      state = "absent";
      label = "Vắng";
    } else if (cell.kind === "late") {
      state = "late";
      label = "Đi muộn";
    } else {
      state = "ok";
      label = "Đủ công";
    }
    const punches = [...(grid.punches[person.userId]?.[day] ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    out.push({
      person,
      cell,
      punches,
      state,
      label,
      afternoon: cell.dayType === "normal" && cell.firstIn != null && vnMinutes(cell.firstIn) >= lunch,
    });
  }
  return out;
}

export function matchesDayFilter(item: DayItem, f: DayFilter): boolean {
  if (f === "all") return true;
  if (f === "offsite") return item.cell.offsite;
  return item.state === f;
}

export function countByFilter(items: DayItem[]): Record<DayFilter, number> {
  const c = { all: items.length, ok: 0, late: 0, partial: 0, absent: 0, off: 0, waiting: 0, offsite: 0 } as Record<DayFilter, number>;
  for (const it of items) {
    c[it.state] += 1;
    if (it.cell.offsite) c.offsite += 1;
  }
  return c;
}

const STATE_TONE: Record<DayItem["state"], "ok" | "late" | "clay" | "muted"> = {
  ok: "ok",
  late: "late",
  partial: "clay",
  absent: "clay",
  off: "muted",
  waiting: "muted",
};

function fmtCong(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`sticky top-0 z-10 border-b-2 border-ink bg-card px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-muted ${className}`}>{children}</th>;
}

function Td({ children, mono, className = "" }: { children?: ReactNode; mono?: boolean; className?: string }) {
  return <td className={`border-b border-line px-3 py-2 align-middle ${mono ? "font-display text-base font-semibold tabular-nums" : "text-sm"} ${className}`}>{children}</td>;
}

export function DayList({
  day,
  items,
  filter,
  onFilter,
  onOpen,
  selectedId,
}: {
  day: string;
  items: DayItem[];
  filter: DayFilter;
  onFilter: (f: DayFilter) => void;
  onOpen: (userId: string) => void;
  selectedId?: string | null;
}) {
  const counts = countByFilter(items);
  const shown = items.filter((it) => matchesDayFilter(it, filter));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo trạng thái trong ngày">
        {DAY_FILTERS.map(([k, t]) => {
          const n = counts[k];
          const bad = (k === "partial" || k === "absent") && n > 0;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => onFilter(k)}
              className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold ${
                filter === k ? "border-night bg-night text-ice" : `border-edge bg-card ${n === 0 ? "opacity-50" : ""} ${bad ? "text-clay" : ""}`
              }`}
            >
              {t}
              <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="max-h-[75dvh] overflow-auto rounded-xl border border-edge bg-card">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <Th className="w-12">#</Th>
              <Th>Nhân viên</Th>
              <Th>Trạng thái</Th>
              <Th>Vào</Th>
              <Th>Ra</Th>
              <Th>Giờ làm</Th>
              <Th>Công</Th>
              <Th>Ghi chú</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it, i) => {
              const { person, cell, punches } = it;
              const bad = it.state === "partial" || it.state === "absent";
              const extra = punches.length > 2 ? punches.length - 2 : 0;
              return (
                <tr
                  key={person.userId}
                  className={`cursor-pointer hover:bg-paper ${selectedId === person.userId ? "bg-ice/40" : bad ? "bg-clay/5" : ""}`}
                  onClick={() => onOpen(person.userId)}
                >
                  <Td className="text-xs text-muted tabular-nums">{i + 1}</Td>
                  <Td>
                    <span className="block font-medium">{person.fullName}</span>
                    <span className="block text-[11px] text-muted">{[person.employeeCode, person.department].filter(Boolean).join(" · ") || "—"}</span>
                  </Td>
                  <Td>
                    <Chip tone={STATE_TONE[it.state]}>{it.label}</Chip>
                    {cell.lateMinutes > 0 ? <span className="ml-1 text-xs text-muted">+{cell.lateMinutes}′</span> : null}
                  </Td>
                  <Td mono>{cell.firstIn ? vnTime(cell.firstIn) : <span className="text-clay">{bad && it.state === "partial" ? "?" : "–"}</span>}</Td>
                  <Td mono>
                    {cell.lastOut ? vnTime(cell.lastOut) : <span className={it.state === "partial" ? "text-clay" : ""}>–</span>}
                    {extra ? <span className="ml-1 text-[10px] font-normal text-muted">+{extra} lượt</span> : null}
                  </Td>
                  <Td mono>{cell.workedMinutes ? minutesToHm(cell.workedMinutes) : "–"}</Td>
                  <Td mono>{cell.cong == null ? "–" : fmtCong(cell.cong)}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {it.afternoon ? <Chip tone="muted">Ca chiều</Chip> : null}
                      {cell.dayType === "sunday" && punches.length ? <Chip tone="muted">Chủ nhật</Chip> : null}
                      {cell.dayType === "holiday" && punches.length ? <Chip tone="muted">Ngày lễ</Chip> : null}
                      {cell.offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
                      {cell.corrected ? <Chip tone="muted">Theo đơn</Chip> : null}
                      {cell.overtimeMinutes > 0 ? <Chip tone="ink">TC {minutesToHm(cell.overtimeMinutes)}</Chip> : null}
                      {cell.extraOvertimeMinutes > 0 ? <Chip tone="ink">TC trưa {minutesToHm(cell.extraOvertimeMinutes)}</Chip> : null}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {items.length === 0 ? `${dayTitle(day)}: không có ai thuộc ngày này (Chủ nhật hoặc chưa tới ngày).` : "Không có nhân viên khớp bộ lọc."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
