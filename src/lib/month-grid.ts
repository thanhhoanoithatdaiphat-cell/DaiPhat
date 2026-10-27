// Logic thuần (không import) để dùng chung cho server, giao diện và test.
export type MonthPunch = {
  id: number;
  type: "in" | "out";
  at: string;
  status: "valid" | "corrected";
  offsite: boolean;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: "none" | "pending" | "approved" | "rejected";
  nearestName: string | null;
  distanceMeters: number | null;
  hasPhoto: boolean;
};

export type DayType = "normal" | "sunday" | "holiday";

export const DEFAULT_SUNDAY_RATE = 1.5;
export const DEFAULT_HOLIDAY_RATE = 2;

export type CellKind = "ok" | "late" | "partial" | "absent" | "off" | "future";

export const DEFAULT_FULL_DAY_MINUTES = 420;
export const DEFAULT_HALF_DAY_MINUTES = 240;

/** Lịch làm việc một ca có nghỉ trưa: sáng start–lunchStart, chiều lunchEnd–end. */
export type Schedule = { start: string; end: string; lunchStart: string; lunchEnd: string };

export const DEFAULT_SCHEDULE: Schedule = { start: "07:30", end: "17:30", lunchStart: "11:30", lunchEnd: "13:30" };

const VN_OFFSET_MIN = 7 * 60;

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Mốc 0h (giờ Việt Nam) của ngày chứa thời điểm ms, tính bằng ms. */
function vnDayStartMs(ms: number): number {
  const shifted = ms + VN_OFFSET_MIN * 60000;
  return Math.floor(shifted / 86400000) * 86400000 - VN_OFFSET_MIN * 60000;
}

/**
 * Cộng từng đoạn vào–ra trong ngày (đoạn chưa ra ca không tính).
 * Có `schedule`: trừ giờ nghỉ trưa; với `clip` (ngày thường) chỉ tính trong khung giờ ca,
 * vào sớm hoặc ra muộn không cộng thêm (phần ra muộn được tính riêng là tăng ca).
 */
export function workedMinutes(
  punches: { type: "in" | "out"; at: string }[],
  opts: { schedule?: Schedule; clip?: boolean } = {},
): number {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  let openIn: number | null = null;
  const pair = (from: number, to: number) => {
    const sc = opts.schedule;
    if (!sc) return Math.max(0, (to - from) / 60000);
    const day = vnDayStartMs(from);
    let a = from;
    let b = to;
    if (opts.clip) {
      a = Math.max(a, day + hmToMin(sc.start) * 60000);
      b = Math.min(b, day + hmToMin(sc.end) * 60000);
    }
    if (b <= a) return 0;
    const ls = day + hmToMin(sc.lunchStart) * 60000;
    const le = day + hmToMin(sc.lunchEnd) * 60000;
    const lunch = Math.max(0, Math.min(b, le) - Math.max(a, ls));
    return (b - a - lunch) / 60000;
  };
  for (const p of sorted) {
    const t = new Date(p.at).getTime();
    if (p.type === "in") openIn = t;
    else if (openIn != null) {
      total += pair(openIn, t);
      openIn = null;
    }
  }
  return Math.round(total);
}

/** 1 công khi đủ `full` phút, 0.5 công khi đủ `half` phút, còn lại 0. */
export function congOf(minutes: number, full: number, half: number): 0 | 0.5 | 1 {
  if (minutes >= full) return 1;
  if (minutes >= half) return 0.5;
  return 0;
}

/**
 * Số phút tăng ca được tính của một đơn tăng ca: chỉ phần nằm trong giờ nghỉ trưa.
 * Phần trong giờ ca đã là giờ làm thường, phần sau giờ ra ca đã tự tính khi chấm ra nên không tính lại ở đây.
 */
export function countableOvertime(start: string, end: string, sc: Schedule): number {
  const a = hmToMin(start);
  const b = hmToMin(end);
  if (b <= a) return 0;
  const overlap = (x1: number, x2: number) => Math.max(0, Math.min(b, x2) - Math.max(a, x1));
  return overlap(hmToMin(sc.lunchStart), hmToMin(sc.lunchEnd));
}

export type DayCell = {
  kind: CellKind;
  label: string;
  /** Số phút làm thực tế trong ngày. */
  workedMinutes: number;
  /** Công của ngày; null khi không áp dụng (nghỉ, lễ, chưa tới, đang làm). */
  cong: number | null;
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: MonthPunch["overtimeStatus"];
  /** Tăng ca theo đơn đã duyệt (giờ nghỉ trưa), cộng riêng với tăng ca khi chấm ra. */
  extraOvertimeMinutes: number;
  offsite: boolean;
  corrected: boolean;
  /** Loại ngày: thường, Chủ nhật hay ngày lễ (lễ ưu tiên hơn Chủ nhật). */
  dayType: DayType;
};

export function monthDayKeys(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = Chủ nhật. Dùng ngày thuần nên không lệch múi giờ. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function buildCell(input: {
  dateKey: string;
  punches: MonthPunch[];
  todayKey: string;
  startedOn: string | null;
  endedOn?: string | null;
  isHoliday?: boolean;
  hasApprovedLeave?: boolean;
  leaveKind?: string | null;
  /** Tổng phút tăng ca theo đơn đã duyệt trong ngày. */
  extraOvertimeMinutes?: number;
  /** Ngưỡng đi muộn của công ty (phút). Muộn khi số phút >= ngưỡng, giống các màn khác. */
  lateThreshold: number;
  /** Lịch ca có nghỉ trưa; bỏ trống thì cộng thẳng giờ vào–ra như trước. */
  schedule?: Schedule;
  fullDayMinutes?: number;
  halfDayMinutes?: number;
  hm: (iso: string) => string;
}): DayCell {
  const { dateKey, punches, todayKey, startedOn, lateThreshold, hm } = input;
  const full = input.fullDayMinutes ?? DEFAULT_FULL_DAY_MINUTES;
  const half = input.halfDayMinutes ?? DEFAULT_HALF_DAY_MINUTES;
  const dayType: DayType = input.isHoliday ? "holiday" : weekdayOf(dateKey) === 0 ? "sunday" : "normal";
  const base = {
    dayType,
    workedMinutes: 0,
    cong: null as number | null,
    firstIn: null,
    lastOut: null,
    lateMinutes: 0,
    overtimeMinutes: 0,
    overtimeStatus: "none" as const,
    extraOvertimeMinutes: Math.max(0, input.extraOvertimeMinutes ?? 0),
    offsite: false,
    corrected: false,
  };
  if (punches.length === 0) {
    if (dateKey > todayKey) return { ...base, kind: "future", label: "" };
    if (weekdayOf(dateKey) === 0) return { ...base, kind: "off", label: "" };
    if (startedOn && dateKey < startedOn) return { ...base, kind: "off", label: "" };
    if (input.endedOn && dateKey > input.endedOn) return { ...base, kind: "off", label: "" };
    // Nghỉ lễ được hưởng nguyên lương: tính 1 công nếu rơi vào thứ 2–thứ 7 (Chủ nhật đã nằm ngoài công chuẩn).
    if (input.isHoliday) return { ...base, cong: 1, kind: "off", label: "L" };
    if (input.hasApprovedLeave) return { ...base, kind: "off", label: input.leaveKind === "om" ? "Ố" : input.leaveKind === "thaisan" ? "T" : "P" };
    if (dateKey === todayKey) return { ...base, kind: "future", label: "" };
    return { ...base, cong: 0, kind: "absent", label: "V" };
  }
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  const first = sorted.find((p) => p.type === "in") ?? null;
  const last = [...sorted].reverse().find((p) => p.type === "out") ?? null;
  const worked = workedMinutes(sorted, { schedule: input.schedule, clip: input.schedule ? dayType === "normal" : false });
  const cell = {
    dayType,
    workedMinutes: worked,
    cong: congOf(worked, full, half) as number | null,
    firstIn: first?.at ?? null,
    lastOut: last?.at ?? null,
    lateMinutes: first?.lateMinutes ?? 0,
    overtimeMinutes: last?.overtimeMinutes ?? 0,
    overtimeStatus: last?.overtimeStatus ?? ("none" as const),
    extraOvertimeMinutes: Math.max(0, input.extraOvertimeMinutes ?? 0),
    offsite: sorted.some((p) => p.offsite),
    corrected: sorted.some((p) => p.status === "corrected"),
  };
  const stillWorking = dateKey === todayKey && first && !last;
  if (!first || (!last && !stillWorking)) {
    return { ...cell, cong: 0, kind: "partial", label: first ? hm(first.at) : "?" };
  }
  if (stillWorking) cell.cong = null;
  const lateBy = first.lateMinutes ?? 0;
  if (lateBy > 0 && lateBy >= lateThreshold) return { ...cell, kind: "late", label: hm(first.at) };
  return { ...cell, kind: "ok", label: hm(first.at) };
}

export type PersonSummary = {
  days: number;
  /** Công ngày thường (không gồm Chủ nhật, lễ). */
  cong: number;
  /** Công làm Chủ nhật đã được duyệt. */
  sundayCong: number;
  /** Công làm ngày lễ đã được duyệt. */
  holidayCong: number;
  /** Công quy đổi = công thường + CN × hệ số CN + lễ × hệ số lễ. */
  congQuyDoi: number;
  /** Số ngày làm Chủ nhật/lễ còn chờ duyệt tăng ca (chưa tính vào công). */
  premiumPending: number;
  leave: number;
  holiday: number;
  late: number;
  absent: number;
  partial: number;
  overtimeMinutes: number;
};

export type PayRates = { sunday: number; holiday: number };

export function summarize(cells: DayCell[], rates: PayRates = { sunday: DEFAULT_SUNDAY_RATE, holiday: DEFAULT_HOLIDAY_RATE }): PersonSummary {
  const s: PersonSummary = {
    days: 0, cong: 0, sundayCong: 0, holidayCong: 0, congQuyDoi: 0, premiumPending: 0,
    leave: 0, holiday: 0, late: 0, absent: 0, partial: 0, overtimeMinutes: 0,
  };
  for (const c of cells) {
    if (c.cong != null && (c.kind === "ok" || c.kind === "late")) {
      if (c.dayType === "normal") s.cong += c.cong;
      else if (c.overtimeStatus === "approved") {
        if (c.dayType === "holiday") s.holidayCong += c.cong;
        else s.sundayCong += c.cong;
      } else s.premiumPending += 1;
    }
    if (c.kind === "off" && c.label === "L") {
      s.holiday += 1;
      if (c.cong != null) s.cong += c.cong;
    }
    if (c.kind === "off" && (c.label === "P" || c.label === "Ố" || c.label === "T")) s.leave += 1;
    if (c.kind === "ok" || c.kind === "late") s.days += 1;
    if (c.kind === "late") s.late += 1;
    if (c.kind === "absent") s.absent += 1;
    if (c.kind === "partial") s.partial += 1;
    if (c.overtimeStatus === "approved") s.overtimeMinutes += c.overtimeMinutes;
    s.overtimeMinutes += c.extraOvertimeMinutes;
  }
  s.congQuyDoi = Math.round((s.cong + s.sundayCong * rates.sunday + s.holidayCong * rates.holiday) * 100) / 100;
  return s;
}
