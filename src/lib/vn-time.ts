export const VN = "Asia/Ho_Chi_Minh";

export function vnDateKey(input: Date | string = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function vnMonthKey(input: Date | string = new Date()): string {
  return vnDateKey(input).slice(0, 7);
}

export function vnTime(input: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(input));
}

export function vnMinutes(input: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(input));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01T00:00:00+07:00`;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`;
  return { start, end };
}

export function nextDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function dayRange(dateKey: string): { start: string; end: string } {
  return {
    start: `${dateKey}T00:00:00+07:00`,
    end: `${nextDateKey(dateKey)}T00:00:00+07:00`,
  };
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function mondayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatVnDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    weekday: "short",
    day: "numeric",
    month: "numeric",
  }).format(date);
}

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1, 5, 0, 0));
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    month: "long",
    year: "numeric",
  }).format(date);
}

export function vnWeekday(input: Date | string = new Date()): number {
  const [y, m, d] = vnDateKey(input).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHm(total: number): string {
  const rounded = Math.round(total);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isLateIn(iso: string, workStart: string, lateMinutes: number): boolean {
  return vnMinutes(iso) > hmToMinutes(workStart) + lateMinutes;
}

export function isEarlyOut(iso: string, workEnd: string): boolean {
  return vnMinutes(iso) < hmToMinutes(workEnd);
}

export function formatMeters(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  const km = meters / 1000;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

export function todayLong(input: Date | string = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}
