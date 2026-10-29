import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type {
  AuditEvent,
  CorrectionRow,
  HistoryData,
  HolidayRow,
  LeaveKind,
  LeaveRow,
  LocationRow,
  MonthGrid,
  MySummary,
  OvertimeRequestRow,
  OvertimeStatus,
  PersonRow,
  ProfileRow,
  PunchResult,
  PunchRow,
  RankLists,
  Role,
  Settings,
  WorkspaceData,
} from "@/lib/attendance-types";
import { dayRange, hmToMinutes, isEarlyOut, minutesToHm, monthRange, vnDateKey, vnMinutes, vnMonthKey, vnWeekday } from "@/lib/vn-time";
import { displayPhone, normalizeVnPhone, phoneFromLoginEmail, phoneLoginEmail } from "@/lib/phone";
import {
  buildCell,
  congOf,
  countableOvertime,
  monthDayKeys,
  summarize,
  workedMinutes as sumWorked,
  type MonthPunch,
} from "@/lib/month-grid";
import { HISTORY_MAX_DAYS, scheduleOf } from "@/lib/attendance-types";

const COMPANY_ID = "co-default";
const PHOTO_MAX = 180_000;

const DEFAULT_SETTINGS: Settings = {
  workStart: "07:30",
  workEnd: "17:30",
  lunchStart: "11:30",
  lunchEnd: "13:30",
  overtimeMinMinutes: 30,
  lateMinutes: 5,
  fullDayMinutes: 420,
  halfDayMinutes: 240,
  maxCorrections: 4,
  standardDays: 26,
  sundayRate: 1.5,
  holidayRate: 2,
  rankingsEnabled: false,
  requirePhoto: true,
  allowOffsite: false,
};

type ProfileDb = {
  user_id: string;
  company_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  employee_code: string | null;
  department: string | null;
  job_title: string | null;
  started_on: unknown;
  avatar_data: string | null;
};

function isHm(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampRate(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(5, Math.max(1, n)) * 100) / 100;
}

async function isHolidayDay(companyId: string, dayKey: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from holidays where company_id = ${companyId} and date = ${dayKey}::date
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

function readSettings(raw: unknown): Settings {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  return {
    workStart: isHm(obj.workStart) ? obj.workStart : DEFAULT_SETTINGS.workStart,
    workEnd: isHm(obj.workEnd) ? obj.workEnd : DEFAULT_SETTINGS.workEnd,
    ...readLunch(obj),
    overtimeMinMinutes: clampNum(obj.overtimeMinMinutes, 0, 240, DEFAULT_SETTINGS.overtimeMinMinutes),
    lateMinutes: clampNum(obj.lateMinutes, 0, 180, DEFAULT_SETTINGS.lateMinutes),
    ...readDayThresholds(obj),
    maxCorrections: clampNum(obj.maxCorrections, 0, 20, DEFAULT_SETTINGS.maxCorrections),
    standardDays: clampNum(obj.standardDays, 20, 31, DEFAULT_SETTINGS.standardDays),
    sundayRate: clampRate(obj.sundayRate, DEFAULT_SETTINGS.sundayRate),
    holidayRate: clampRate(obj.holidayRate, DEFAULT_SETTINGS.holidayRate),
    rankingsEnabled: obj.rankingsEnabled === true,
    requirePhoto: obj.requirePhoto !== false,
    allowOffsite: obj.allowOffsite === true,
  };
}

function readLunch(obj: Record<string, unknown>): { lunchStart: string; lunchEnd: string } {
  const start = isHm(obj.lunchStart) ? obj.lunchStart : DEFAULT_SETTINGS.lunchStart;
  const end = isHm(obj.lunchEnd) ? obj.lunchEnd : DEFAULT_SETTINGS.lunchEnd;
  return hmToMinutes(start) < hmToMinutes(end) ? { lunchStart: start, lunchEnd: end } : { lunchStart: DEFAULT_SETTINGS.lunchStart, lunchEnd: DEFAULT_SETTINGS.lunchEnd };
}

function readDayThresholds(obj: Record<string, unknown>): { fullDayMinutes: number; halfDayMinutes: number } {
  const full = clampNum(obj.fullDayMinutes, 60, 960, DEFAULT_SETTINGS.fullDayMinutes);
  const half = clampNum(obj.halfDayMinutes, 30, 960, DEFAULT_SETTINGS.halfDayMinutes);
  return half < full ? { fullDayMinutes: full, halfDayMinutes: half } : { fullDayMinutes: DEFAULT_SETTINGS.fullDayMinutes, halfDayMinutes: DEFAULT_SETTINGS.halfDayMinutes };
}

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function dateOnly(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (value instanceof Date) return vnDateKey(value);
  return vnDateKey();
}

function mapProfile(row: ProfileDb): ProfileRow {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    companyId: row.company_id,
    employeeCode: row.employee_code,
    department: row.department,
    jobTitle: row.job_title,
    startedOn: row.started_on ? dateOnly(row.started_on) : null,
    avatar: row.avatar_data,
  };
}


async function isOnlyReviewer(companyId: string, userId: string): Promise<boolean> {
  const sql = await getSql();
  const others = await sql<{ n: number }>`
    select count(*)::int as n from profiles
    where company_id = ${companyId}
      and user_id <> ${userId}
      and role in ('approver', 'admin')
      and is_active = true
  `;
  return Number(others[0]?.n ?? 0) === 0;
}

function canReview(role: Role): boolean {
  return role === "admin" || role === "approver";
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function assertMonthOpen(companyId: string, dateKey: string) {
  const sql = await getSql();
  const rows = await sql<{ month: string }>`
    select month from timesheet_locks where company_id = ${companyId} and month = ${dateKey.slice(0, 7)}
  `;
  if (rows[0]) throw new Error("Tháng này đã chốt công. Hãy nhờ quản trị mở khóa nếu cần sửa.");
}

function assertMonth(ym: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error("Tháng không hợp lệ");
  return ym;
}

async function loadProfile(userId: string, hint?: { displayName?: string; email?: string }) {
  const sql = await getSql();
  const existing = await sql<ProfileDb>`
    select user_id, company_id, full_name, email, phone, role,
           employee_code, department, job_title, started_on, avatar_data
    from profiles where user_id = ${userId}
  `;
  if (existing[0]) {
    const row = existing[0];
    const nextName =
      hint?.displayName?.trim() && (row.full_name === "" || row.full_name === "Nhân viên")
        ? hint.displayName.trim().slice(0, 80)
        : null;
    const nextEmail = hint?.email?.trim() && !row.email ? hint.email.trim().slice(0, 120) : null;
    const loginPhone = phoneFromLoginEmail(hint?.email ?? row.email);
    const nextPhone = !row.phone && loginPhone ? loginPhone : null;
    if (nextName || nextEmail || nextPhone) {
      const updated = await sql<ProfileDb>`
        update profiles
        set full_name = coalesce(${nextName}, full_name),
            email = coalesce(${nextEmail}, email),
            phone = coalesce(${nextPhone}, phone)
        where user_id = ${userId}
        returning user_id, company_id, full_name, email, phone, role,
                  employee_code, department, job_title, started_on, avatar_data
      `;
      return mapProfile(updated[0] ?? row);
    }
    return mapProfile(row);
  }

  const counts = await sql<{ n: number }>`select count(*)::int as n from profiles where role = 'admin'`;
  const role: Role = Number(counts[0]?.n ?? 0) === 0 ? "admin" : "employee";
  const name = hint?.displayName?.trim().slice(0, 80) || "Nhân viên";
  const email = hint?.email?.trim().slice(0, 120) || null;
  const phone = phoneFromLoginEmail(email);
  const inserted = await sql<ProfileDb>`
    insert into profiles (user_id, company_id, full_name, email, phone, role)
    values (${userId}, ${COMPANY_ID}, ${name}, ${email}, ${phone}, ${role})
    on conflict (user_id) do update set full_name = profiles.full_name
    returning user_id, company_id, full_name, email, phone, role,
              employee_code, department, job_title, started_on, avatar_data
  `;
  if (!inserted[0]) throw new Error("Không tạo được hồ sơ");
  return mapProfile(inserted[0]);
}

async function requireProfile(userId: string) {
  return loadProfile(userId);
}

type GeoJson = { name?: string; display_name?: string; address?: Record<string, string> };

async function nominatim(lat: number, lng: number, zoom: number): Promise<GeoJson | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=${zoom}&accept-language=vi&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "VaoCa-ChamCong/1.0 (noithatdaiphat)" } });
    return res.ok ? ((await res.json()) as GeoJson) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function roadOf(j: GeoJson): string {
  const a = j.address ?? {};
  return a.road || a.pedestrian || a.residential || a.path || a.footway || a.highway || a.service || "";
}

/**
 * Tra địa chỉ từ toạ độ (OpenStreetMap Nominatim), ưu tiên tên đường: "Số nhà + tên đường, phường/xã, quận/huyện, tỉnh/thành".
 * Lỗi hoặc quá chậm thì trả null, không chặn việc chấm công.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  let j = await nominatim(lat, lng, 18);
  if (!j) return null;
  // Chưa ra tên đường thì thử lại ở mức xa hơn một chút (đường lớn gần đó).
  if (!roadOf(j)) {
    const wider = await nominatim(lat, lng, 16);
    if (wider && roadOf(wider)) j = wider;
  }
  const a = j.address ?? {};
  const road = roadOf(j);
  const street = [a.house_number, road].filter(Boolean).join(" ");
  const parts = [
    street || j.name || a.amenity || a.building,
    a.quarter || a.suburb || a.neighbourhood || a.village || a.hamlet,
    a.city_district || a.district || a.county,
    a.city || a.town || a.state || a.province,
  ].filter(Boolean) as string[];
  const text = parts.length >= 2 ? parts.join(", ") : (j.display_name ?? "");
  const out = text.trim().slice(0, 220);
  return out ? (road ? out : `${out} (chưa rõ tên đường)`) : null;
}

/** Phút tăng ca theo đơn đã duyệt: userId -> ngày -> phút. */
async function loadExtraOt(
  sql: Awaited<ReturnType<typeof getSql>>,
  companyId: string,
  from: string,
  toExclusive: string,
  userId?: string,
): Promise<Record<string, Record<string, number>>> {
  const rows = await sql<{ user_id: string; work_date: unknown; minutes: number }>`
    select user_id, work_date, minutes from overtime_requests
    where company_id = ${companyId} and status = 'approved'
      and work_date >= ${from}::date and work_date < ${toExclusive}::date
      and (${userId ?? null}::text is null or user_id = ${userId ?? null})
  `;
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const day = dateOnly(r.work_date);
    const byDay = (out[r.user_id] ??= {});
    byDay[day] = (byDay[day] ?? 0) + Number(r.minutes);
  }
  return out;
}

function mapPunch(row: {
  id: number;
  type: "in" | "out";
  punched_at: unknown;
  status: "valid" | "corrected";
  nearest_name: string | null;
  distance_meters: number | null;
  location_source: "gps" | "manual";
  has_photo: boolean;
  offsite?: boolean;
  late_minutes?: number;
  overtime_minutes?: number;
  overtime_status?: OvertimeStatus;
  user_id?: string;
  full_name?: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}): PunchRow {
  return {
    id: Number(row.id),
    type: row.type,
    punchedAt: stamp(row.punched_at),
    status: row.status,
    nearestName: row.nearest_name,
    distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
    locationSource: row.location_source,
    hasPhoto: Boolean(row.has_photo),
    offsite: Boolean(row.offsite),
    lateMinutes: Number(row.late_minutes ?? 0),
    overtimeMinutes: Number(row.overtime_minutes ?? 0),
    overtimeStatus: row.overtime_status ?? "none",
    userId: row.user_id,
    fullName: row.full_name,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    address: row.address ?? null,
  };
}

function mapLocation(row: {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  is_active: boolean;
}): LocationRow {
  return {
    id: Number(row.id),
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    radiusMeters: Number(row.radius_meters),
    isActive: Boolean(row.is_active),
  };
}

export const getWorkspace = createServerFn({ method: "POST" })
  .validator((input: { displayName?: string; email?: string }) => ({
    displayName: (input?.displayName ?? "").slice(0, 80),
    email: (input?.email ?? "").slice(0, 120),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<WorkspaceData> => {
    const profile = await loadProfile(context.userId, data);
    const sql = await getSql();
    const companies = await sql<{ name: string; settings: unknown }>`
      select name, settings from companies where id = ${profile.companyId}
    `;
    const company = companies[0];
    if (!company) throw new Error("Không tìm thấy công ty");
    const settings = readSettings(company.settings);
    const locationRows = await sql<{
      id: number;
      name: string;
      lat: number;
      lng: number;
      radius_meters: number;
      is_active: boolean;
    }>`
      select id, name, lat, lng, radius_meters, is_active
      from locations where company_id = ${profile.companyId}
      order by is_active desc, name asc
    `;
    const locations = locationRows.map(mapLocation);
    const todayKey = vnDateKey();
    const dayStart = `${todayKey}T00:00:00+07:00`;
    const dayEndDate = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000);
    const dayEnd = dayEndDate.toISOString();
    const todayRows = await sql<{
      id: number;
      type: "in" | "out";
      punched_at: unknown;
      status: "valid" | "corrected";
      nearest_name: string | null;
      distance_meters: number | null;
      location_source: "gps" | "manual";
      has_photo: boolean;
    }>`
      select id, type, punched_at, status, nearest_name, distance_meters, location_source, offsite,
             late_minutes, overtime_minutes, overtime_status,
             (photo_data is not null and photo_data <> '') as has_photo
      from attendances
      where user_id = ${profile.userId}
        and punched_at >= ${dayStart}::timestamptz
        and punched_at < ${dayEnd}::timestamptz
      order by punched_at asc
    `;
    const pending = await sql<{ n: number }>`
      select (
        (select count(*) from correction_requests
          where company_id = ${profile.companyId} and status = 'pending'
            and (${canReview(profile.role)} or user_id = ${profile.userId}))
        +
        (select count(*) from overtime_requests
          where company_id = ${profile.companyId} and status = 'pending'
            and (${canReview(profile.role)} or user_id = ${profile.userId}))
      )::int as n
    `;
    let teamToday: PersonRow[] = [];
    if (canReview(profile.role)) {
      // Nhân viên nghỉ việc quá LEFT_VISIBLE_DAYS ngày thì không hiện trong danh sách nữa.
      const hideBefore = vnDateKey(new Date(Date.now() - LEFT_VISIBLE_DAYS * 86_400_000));
      const people = await sql<{
        user_id: string;
        full_name: string;
        email: string | null;
        phone: string | null;
        role: Role;
        type: "in" | "out" | null;
        punched_at: unknown;
        first_in_at: unknown;
        first_in_late: number | null;
        employee_code: string | null;
        department: string | null;
        job_title: string | null;
        started_on: unknown;
        ended_on: unknown;
        is_active: boolean;
      }>`
        select p.user_id, p.full_name, p.email, p.phone, p.role, a.type, a.punched_at,
               f.punched_at as first_in_at, f.late_minutes as first_in_late,
               p.employee_code, p.department, p.job_title, p.started_on, p.ended_on, p.is_active
        from profiles p
        left join lateral (
          select type, punched_at from attendances
          where user_id = p.user_id
            and punched_at >= ${dayStart}::timestamptz
            and punched_at < ${dayEnd}::timestamptz
          order by punched_at desc
          limit 1
        ) a on true
        left join lateral (
          select punched_at, late_minutes from attendances
          where user_id = p.user_id
            and type = 'in'
            and punched_at >= ${dayStart}::timestamptz
            and punched_at < ${dayEnd}::timestamptz
          order by punched_at asc
          limit 1
        ) f on true
        where p.company_id = ${profile.companyId}
          and (p.is_active = true or p.ended_on is null or p.ended_on > ${hideBefore}::date)
        order by p.full_name asc
      `;
      teamToday = people.map((p) => ({
        userId: p.user_id,
        fullName: p.full_name,
        email: p.email,
        phone: p.phone,
        role: p.role,
        lastType: p.type,
        lastAt: p.punched_at ? stamp(p.punched_at) : null,
        firstInAt: p.first_in_at ? stamp(p.first_in_at) : null,
        firstInLate: Number(p.first_in_late ?? 0),
        employeeCode: p.employee_code,
        department: p.department,
        jobTitle: p.job_title,
        startedOn: p.started_on ? dateOnly(p.started_on) : null,
        endedOn: p.ended_on ? dateOnly(p.ended_on) : null,
        isActive: Boolean(p.is_active),
      }));
    }
    let offsiteToday: PunchRow[] = [];
    if (canReview(profile.role)) {
      const alerts = await sql<{
        id: number;
        type: "in" | "out";
        punched_at: unknown;
        status: "valid" | "corrected";
        nearest_name: string | null;
        distance_meters: number | null;
        location_source: "gps" | "manual";
        has_photo: boolean;
        offsite: boolean;
        user_id: string;
        full_name: string;
        lat: number | null;
        lng: number | null;
        address: string | null;
      }>`
        select a.id, a.type, a.punched_at, a.status, a.nearest_name, a.distance_meters,
               a.location_source, a.offsite, a.lat, a.lng, a.address,
               (a.photo_data is not null and a.photo_data <> '') as has_photo,
               a.user_id, p.full_name
        from attendances a
        join profiles p on p.user_id = a.user_id
        where a.company_id = ${profile.companyId}
          and a.offsite = true
          and a.punched_at >= ${dayStart}::timestamptz
          and a.punched_at < ${dayEnd}::timestamptz
        order by a.punched_at desc
      `;
      offsiteToday = alerts.map(mapPunch);
    }
    let lateToday: PunchRow[] = [];
    let overtimePending: PunchRow[] = [];
    if (canReview(profile.role)) {
      const lateRows = await sql<{
        id: number;
        type: "in" | "out";
        punched_at: unknown;
        status: "valid" | "corrected";
        nearest_name: string | null;
        distance_meters: number | null;
        location_source: "gps" | "manual";
        has_photo: boolean;
        offsite: boolean;
        late_minutes: number;
        overtime_minutes: number;
        overtime_status: OvertimeStatus;
        user_id: string;
        full_name: string;
      }>`
        select a.id, a.type, a.punched_at, a.status, a.nearest_name, a.distance_meters,
               a.location_source, a.offsite, a.late_minutes, a.overtime_minutes, a.overtime_status,
               (a.photo_data is not null and a.photo_data <> '') as has_photo,
               a.user_id, p.full_name
        from attendances a
        join profiles p on p.user_id = a.user_id
        where a.company_id = ${profile.companyId}
          and a.type = 'in'
          and a.late_minutes >= ${settings.lateMinutes}
          and a.punched_at >= ${dayStart}::timestamptz
          and a.punched_at < ${dayEnd}::timestamptz
        order by a.punched_at desc
      `;
      const otRows = await sql<{
        id: number;
        type: "in" | "out";
        punched_at: unknown;
        status: "valid" | "corrected";
        nearest_name: string | null;
        distance_meters: number | null;
        location_source: "gps" | "manual";
        has_photo: boolean;
        offsite: boolean;
        late_minutes: number;
        overtime_minutes: number;
        overtime_status: OvertimeStatus;
        user_id: string;
        full_name: string;
      }>`
        select a.id, a.type, a.punched_at, a.status, a.nearest_name, a.distance_meters,
               a.location_source, a.offsite, a.late_minutes, a.overtime_minutes, a.overtime_status,
               (a.photo_data is not null and a.photo_data <> '') as has_photo,
               a.user_id, p.full_name
        from attendances a
        join profiles p on p.user_id = a.user_id
        where a.company_id = ${profile.companyId}
          and a.overtime_status = 'pending'
        order by a.punched_at desc
        limit 40
      `;
      lateToday = lateRows.map(mapPunch);
      overtimePending = otRows.map(mapPunch);
    }
    return {
      profile,
      companyName: company.name,
      settings,
      locations: profile.role === "admin" ? locations : locations.filter((l) => l.isActive),
      today: todayRows.map(mapPunch),
      teamToday,
      pendingCount: Number(pending[0]?.n ?? 0),
      offsiteToday,
      lateToday,
      overtimePending,
    };
  });

/** Công tích lũy của chính người dùng trong tháng hiện tại (cùng quy tắc với bảng công). */
export const getMySummary = createServerFn({ method: "POST" })
  .validator((month: string) => assertMonth(month))
  .middleware([authMiddleware])
  .handler(async ({ context, data: month }): Promise<MySummary> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const todayKey = vnDateKey();
    const { start, end } = monthRange(month);
    const companies = await sql<{ settings: unknown }>`
      select settings from companies where id = ${profile.companyId}
    `;
    const settings = readSettings(companies[0]?.settings);
    const rows = await sql<{
      id: number;
      type: "in" | "out";
      punched_at: unknown;
      status: "valid" | "corrected";
      offsite: boolean;
      late_minutes: number;
      overtime_minutes: number;
      overtime_status: OvertimeStatus;
    }>`
      select id, type, punched_at, status, offsite, late_minutes, overtime_minutes, overtime_status
      from attendances
      where user_id = ${profile.userId}
        and company_id = ${profile.companyId}
        and punched_at >= ${start}::timestamptz
        and punched_at < ${end}::timestamptz
        and status in ('valid', 'corrected')
      order by punched_at asc
    `;
    const holidayRows = await sql<{ date: unknown }>`
      select date from holidays where company_id = ${profile.companyId}
        and date >= ${start}::date and date < ${end}::date
    `;
    const leaveRows = await sql<{ leave_date: unknown; kind: string }>`
      select leave_date, kind from leave_requests
      where company_id = ${profile.companyId} and user_id = ${profile.userId} and status = 'approved'
        and leave_date >= ${start}::date and leave_date < ${end}::date
    `;
    const holidays = new Set(holidayRows.map((r) => dateOnly(r.date)));
    const leaves = new Map(leaveRows.map((r) => [dateOnly(r.leave_date), r.kind]));
    const byDay = new Map<string, MonthPunch[]>();
    for (const row of rows) {
      const at = stamp(row.punched_at);
      const day = vnDateKey(at);
      const list = byDay.get(day) ?? [];
      list.push({
        id: Number(row.id),
        type: row.type,
        at,
        status: row.status,
        offsite: Boolean(row.offsite),
        lateMinutes: Number(row.late_minutes ?? 0),
        overtimeMinutes: Number(row.overtime_minutes ?? 0),
        overtimeStatus: row.overtime_status ?? "none",
        nearestName: null,
        distanceMeters: null,
        hasPhoto: false,
      });
      byDay.set(day, list);
    }
    const startedOn = profile.startedOn ?? null;
    const cells = monthDayKeys(month).map((dateKey) =>
      buildCell({
        dateKey,
        punches: byDay.get(dateKey) ?? [],
        todayKey,
        startedOn,
        isHoliday: holidays.has(dateKey),
        hasApprovedLeave: leaves.has(dateKey),
        leaveKind: leaves.get(dateKey) ?? null,
        lateThreshold: settings.lateMinutes,
        schedule: scheduleOf(settings),
        fullDayMinutes: settings.fullDayMinutes,
        halfDayMinutes: settings.halfDayMinutes,
        hm: (iso) => minutesToHm(vnMinutes(iso)),
      }),
    );
    const sum = summarize(cells, { sunday: settings.sundayRate, holiday: settings.holidayRate });
    return { month, cong: sum.cong + sum.sundayCong * settings.sundayRate + sum.holidayCong * settings.holidayRate, standardDays: settings.standardDays };
  });

export const listHistory = createServerFn({ method: "POST" })
  .validator((month: string) => assertMonth(month))
  .middleware([authMiddleware])
  .handler(async ({ context, data: month }): Promise<PunchRow[]> => {
    const profile = await requireProfile(context.userId);
    const { start, end } = monthRange(month);
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      type: "in" | "out";
      punched_at: unknown;
      status: "valid" | "corrected";
      nearest_name: string | null;
      distance_meters: number | null;
      location_source: "gps" | "manual";
      has_photo: boolean;
    }>`
      select id, type, punched_at, status, nearest_name, distance_meters, location_source, offsite,
             late_minutes, overtime_minutes, overtime_status,
             (photo_data is not null and photo_data <> '') as has_photo
      from attendances
      where user_id = ${profile.userId}
        and company_id = ${profile.companyId}
        and punched_at >= ${start}::timestamptz
        and punched_at < ${end}::timestamptz
      order by punched_at desc
    `;
    return rows.map(mapPunch);
  });

/** Địa chỉ hiện tại của người dùng (hiện trên màn chấm công khi đang ngoài phạm vi). */
export const whereAmI = createServerFn({ method: "POST" })
  .validator((input: { lat: number; lng: number }) => {
    if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lng) || Math.abs(input.lng) > 180) {
      throw new Error("Toạ độ không hợp lệ");
    }
    return { lat: Math.round(input.lat * 1e5) / 1e5, lng: Math.round(input.lng * 1e5) / 1e5 };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    await requireProfile(context.userId);
    return { address: await reverseGeocode(data.lat, data.lng) };
  });

export const punch = createServerFn({ method: "POST" })
  .validator(
    (input: {
      type: "in" | "out";
      lat: number;
      lng: number;
      photo: string;
      locationSource: "gps" | "manual";
      accuracy?: number;
    }) => {
      if (input.type !== "in" && input.type !== "out") throw new Error("Loại chấm công không hợp lệ");
      if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
        throw new Error("Vĩ độ không hợp lệ");
      }
      if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
        throw new Error("Kinh độ không hợp lệ");
      }
      if (input.locationSource !== "gps") {
        throw new Error("Chỉ chấp nhận vị trí GPS của máy.");
      }
      const accuracy = input.accuracy == null ? null : Number(input.accuracy);
      if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)) {
        throw new Error("Sai số GPS không hợp lệ");
      }
      if (accuracy != null && accuracy > 200) {
        throw new Error(`GPS không chính xác (sai số ~${Math.round(accuracy)} m). Ra nơi thoáng hơn rồi thử lại.`);
      }
      return input;
    },
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<PunchResult> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const companies = await sql<{ settings: unknown }>`
      select settings from companies where id = ${profile.companyId}
    `;
    const settings = readSettings(companies[0]?.settings);
    const photo = data.photo ?? "";
    if (settings.requirePhoto) {
      if (!photo.startsWith("data:image/jpeg;base64,") || photo.length < 32 || photo.length > PHOTO_MAX) {
        throw new Error("Ảnh không hợp lệ. Hãy chụp lại, gần hơn và đủ sáng.");
      }
    } else if (photo && (!photo.startsWith("data:image/jpeg;base64,") || photo.length > PHOTO_MAX)) {
      throw new Error("Ảnh không hợp lệ.");
    }
    const recent = await sql<{ punched_at: unknown }>`
      select punched_at from attendances
      where user_id = ${profile.userId}
      order by punched_at desc
      limit 1
    `;
    if (recent[0]) {
      const delta = Date.now() - new Date(stamp(recent[0].punched_at)).getTime();
      if (delta >= 0 && delta < 60_000) {
        throw new Error("Bạn vừa chấm công. Đợi khoảng một phút rồi thử lại.");
      }
    }
    const todayBounds = dayRange(vnDateKey());
    const lastToday = await sql<{ type: "in" | "out" }>`
      select type from attendances
      where user_id = ${profile.userId}
        and punched_at >= ${todayBounds.start}::timestamptz
        and punched_at < ${todayBounds.end}::timestamptz
      order by punched_at desc
      limit 1
    `;
    const lastType = lastToday[0]?.type ?? null;
    if (data.type === "in" && lastType === "in") {
      throw new Error("Bạn đang trong ca. Hãy ra ca trước khi vào ca tiếp.");
    }
    if (data.type === "out" && lastType !== "in") {
      throw new Error("Chưa có lần vào ca hôm nay. Hãy vào ca trước.");
    }
    const locs = await sql<{
      name: string;
      lat: number;
      lng: number;
      radius_meters: number;
    }>`
      select name, lat, lng, radius_meters from locations
      where company_id = ${profile.companyId} and is_active = true
    `;
    if (locs.length === 0 && !settings.allowOffsite) {
      throw new Error("Chưa có điểm chấm công nào đang bật. Nhờ quản trị thêm vị trí.");
    }
    let best: { name: string; dist: number; inside: boolean } | null = null;
    for (const loc of locs) {
      const dist = haversine(data.lat, data.lng, Number(loc.lat), Number(loc.lng));
      const inside = dist <= Number(loc.radius_meters);
      if (!best || (inside && !best.inside) || (inside === best.inside && dist < best.dist)) {
        best = { name: loc.name, dist, inside };
      }
    }
    const distanceMeters = best ? Math.round(best.dist) : 0;
    const offsite = !best?.inside;
    // Chấm ngoài điểm: báo đúng vị trí người chấm (địa chỉ), không báo khoảng cách theo bán kính.
    const address = offsite ? await reverseGeocode(data.lat, data.lng) : null;
    if (offsite && !settings.allowOffsite) {
      const where = address ?? `toạ độ ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
      return {
        ok: false,
        nearestName: best?.name ?? "",
        distanceMeters,
        address,
        message: `Bạn đang ở ${where}, ngoài vùng chấm công. Hãy đến điểm làm việc hoặc nhờ quản trị bật "cho phép ngoài điểm".`,
      };
    }
    const punchedAt = new Date().toISOString();
    const clock = vnMinutes(punchedAt);
    // Chủ nhật hoặc ngày lễ: cả buổi làm tính tăng ca (chờ duyệt), không tính đi muộn
    const sunday = vnWeekday(punchedAt) === 0 || (await isHolidayDay(profile.companyId, vnDateKey(punchedAt)));
    let lateMinutes = 0;
    let overtimeMinutes = 0;
    let overtimeStatus: OvertimeStatus = "none";
    // Chỉ tính muộn cho lần VÀO đầu tiên trong ngày
    const existingIns = await sql<{ n: number }>`
      select count(*)::int as n from attendances
      where user_id = ${profile.userId}
        and type = 'in'
        and punched_at >= ${todayBounds.start}::timestamptz
        and punched_at < ${todayBounds.end}::timestamptz
        and status in ('valid', 'corrected')
    `;
    const isFirstIn = data.type === "in" && Number(existingIns[0]?.n ?? 0) === 0;
    if (sunday) {
      if (data.type === "out") {
        const todayRows = await sql<{ type: "in" | "out"; punched_at: unknown }>`
          select type, punched_at from attendances
          where user_id = ${profile.userId}
            and punched_at >= ${todayBounds.start}::timestamptz
            and punched_at < ${todayBounds.end}::timestamptz
          order by punched_at asc
        `;
        const points = [
          ...todayRows.map((row) => ({ type: row.type, at: stamp(row.punched_at) })),
          { type: "out" as const, at: punchedAt },
        ];
        // Chủ nhật/lễ: cả buổi làm là tăng ca, trừ giờ nghỉ trưa
        const minutes = sumWorked(points, { schedule: scheduleOf(settings), clip: false });
        overtimeMinutes = Math.round(minutes);
        overtimeStatus = overtimeMinutes > 0 ? "pending" : "none";
      }
    } else {
      if (isFirstIn) {
        lateMinutes = Math.max(0, clock - hmToMinutes(settings.workStart));
      }
      overtimeMinutes = data.type === "out" ? Math.max(0, clock - hmToMinutes(settings.workEnd)) : 0;
      overtimeStatus = overtimeMinutes >= settings.overtimeMinMinutes ? "pending" : "none";
    }
    // Recheck ngay trước khi insert để giảm race condition (hai tab bấm cùng lúc)
    const recheck = await sql<{ type: "in" | "out" }>`
      select type from attendances
      where user_id = ${profile.userId}
        and punched_at >= ${todayBounds.start}::timestamptz
        and punched_at < ${todayBounds.end}::timestamptz
      order by punched_at desc
      limit 1
    `;
    const reLast = recheck[0]?.type ?? null;
    if (data.type === "in" && reLast === "in") {
      throw new Error("Bạn đang trong ca. Hãy ra ca trước khi vào ca tiếp.");
    }
    if (data.type === "out" && reLast !== "in") {
      throw new Error("Chưa có lần vào ca hôm nay. Hãy vào ca trước.");
    }
    const inserted = await sql<{ punched_at: unknown }>`
      insert into attendances (
        user_id, company_id, type, punched_at, lat, lng, photo_data, status,
        nearest_name, distance_meters, location_source, offsite,
        late_minutes, overtime_minutes, overtime_status, address
      ) values (
        ${profile.userId}, ${profile.companyId}, ${data.type}, ${punchedAt}::timestamptz, ${data.lat}, ${data.lng},
        ${photo || null}, 'valid', ${best?.name ?? null}, ${best ? distanceMeters : null},
        ${data.locationSource}, ${offsite}, ${lateMinutes}, ${overtimeMinutes}, ${overtimeStatus}, ${address}
      )
      returning punched_at
    `;
    return {
      ok: true,
      nearestName: best?.name ?? "",
      distanceMeters,
      punchedAt: stamp(inserted[0]?.punched_at),
      offsite,
      lateMinutes,
      overtimeMinutes,
      overtimeStatus,
      lat: data.lat,
      lng: data.lng,
      address,
    };
  });

export const getPunchPhoto = createServerFn({ method: "POST" })
  .validator((id: number) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new Error("Không tìm thấy ảnh");
    return n;
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }): Promise<{ photo: string | null }> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      photo_data: string | null;
      user_id: string;
      company_id: string;
    }>`
      select photo_data, user_id, company_id from attendances where id = ${id}
    `;
    const row = rows[0];
    if (!row || row.company_id !== profile.companyId) throw new Error("Không tìm thấy ảnh");
    if (row.user_id !== profile.userId && !canReview(profile.role)) {
      throw new Error("Không có quyền xem ảnh này");
    }
    return { photo: row.photo_data };
  });

export const listCorrections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CorrectionRow[]> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      user_id: string;
      full_name: string;
      attendance_date: unknown;
      punch_type: "in" | "out";
      requested_time: string;
      kind: string;
      note: string;
      status: "pending" | "approved" | "rejected";
      review_note: string | null;
      created_at: unknown;
      reviewed_at: unknown;
      reviewer_name: string | null;
    }>`
      select c.id, c.user_id, p.full_name, c.attendance_date, c.punch_type, c.requested_time,
             c.kind, c.note, c.status, c.review_note, c.created_at, c.reviewed_at,
             r.full_name as reviewer_name
      from correction_requests c
      join profiles p on p.user_id = c.user_id
      left join profiles r on r.user_id = c.reviewed_by
      where c.company_id = ${profile.companyId}
        and (${canReview(profile.role)} or c.user_id = ${profile.userId})
      order by case when c.status = 'pending' then 0 else 1 end, c.created_at desc
      limit 80
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id,
      fullName: row.full_name,
      attendanceDate: dateOnly(row.attendance_date),
      punchType: row.punch_type,
      requestedTime: row.requested_time,
      kind: row.kind,
      note: row.note,
      status: row.status,
      reviewNote: row.review_note,
      createdAt: stamp(row.created_at),
      reviewedByName: row.reviewer_name,
      reviewedAt: row.reviewed_at ? stamp(row.reviewed_at) : null,
    }));
  });

const KINDS = new Set(["quen", "gps", "congtac", "khac"]);

export const createCorrection = createServerFn({ method: "POST" })
  .validator(
    (input: {
      attendanceDate: string;
      punchType: "in" | "out";
      requestedTime: string;
      kind: string;
      note: string;
    }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.attendanceDate)) throw new Error("Ngày không hợp lệ");
      if (input.punchType !== "in" && input.punchType !== "out") throw new Error("Chọn vào hoặc ra");
      if (!isHm(input.requestedTime)) throw new Error("Giờ không hợp lệ");
      if (!KINDS.has(input.kind)) throw new Error("Chọn lý do");
      const note = input.note.trim();
      if (note.length < 4) throw new Error("Ghi chú cần ít nhất 4 ký tự");
      if (note.length > 500) throw new Error("Ghi chú quá dài");
      if (input.attendanceDate > vnDateKey()) throw new Error("Không gửi đơn cho ngày tương lai");
      return { ...input, note };
    },
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    await assertMonthOpen(profile.companyId, data.attendanceDate);
    const sql = await getSql();
    const companies = await sql<{ settings: unknown }>`
      select settings from companies where id = ${profile.companyId}
    `;
    const settings = readSettings(companies[0]?.settings);
    const { start, end } = monthRange(vnDateKey().slice(0, 7));
    const counts = await sql<{ n: number }>`
      select count(*)::int as n from correction_requests
      where user_id = ${profile.userId}
        and status <> 'rejected'
        and created_at >= ${start}::timestamptz
        and created_at < ${end}::timestamptz
    `;
    if (Number(counts[0]?.n ?? 0) >= settings.maxCorrections) {
      throw new Error(`Tháng này bạn đã dùng hết ${settings.maxCorrections} đơn sửa.`);
    }
    const open = await sql<{ id: number }>`
      select id from correction_requests
      where user_id = ${profile.userId}
        and attendance_date = ${data.attendanceDate}::date
        and punch_type = ${data.punchType}
        and status = 'pending'
      limit 1
    `;
    if (open[0]) throw new Error("Đã có đơn chờ cho ngày và loại này.");
    await sql`
      insert into correction_requests (
        user_id, company_id, attendance_date, punch_type, requested_time, kind, note
      ) values (
        ${profile.userId}, ${profile.companyId}, ${data.attendanceDate}::date,
        ${data.punchType}, ${data.requestedTime}, ${data.kind}, ${data.note}
      )
    `;
    return { ok: true };
  });

export const reviewCorrection = createServerFn({ method: "POST" })
  .validator((input: { id: number; decision: "approved" | "rejected"; reviewNote: string }) => {
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Đơn không hợp lệ");
    if (input.decision !== "approved" && input.decision !== "rejected") {
      throw new Error("Quyết định không hợp lệ");
    }
    return {
      id,
      decision: input.decision,
      reviewNote: (input.reviewNote ?? "").trim().slice(0, 300),
    };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Bạn không có quyền duyệt đơn");
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      user_id: string;
      attendance_date: unknown;
      punch_type: "in" | "out";
      requested_time: string;
      status: string;
    }>`
      select id, user_id, attendance_date, punch_type, requested_time, status
      from correction_requests
      where id = ${data.id} and company_id = ${profile.companyId}
    `;
    const row = rows[0];
    if (!row || row.status !== "pending") throw new Error("Đơn không còn chờ duyệt");
    if (row.user_id === profile.userId) {
        const only = await isOnlyReviewer(profile.companyId, profile.userId);
        if (!only) throw new Error("Không tự duyệt đơn của mình");
      }
    if (data.decision === "approved") {
      const day = dateOnly(row.attendance_date);
      await assertMonthOpen(profile.companyId, day);
      const punchedAt = `${day}T${row.requested_time}:00+07:00`;
      const settings = readSettings((await sql<{ settings: unknown }>`select settings from companies where id = ${profile.companyId}`)[0]?.settings);
      let lateMinutes = 0;
      let overtimeMinutes = 0;
      let overtimeStatus: OvertimeStatus = "none";
      const clock = hmToMinutes(row.requested_time);
      const sunday = vnWeekday(day + "T00:00:00+07:00") === 0 || (await isHolidayDay(profile.companyId, day));
      if (!sunday && row.punch_type === "in") {
        // Chỉ tính muộn nếu đây sẽ là lần vào đầu tiên (hoặc sớm nhất)
        const existing = await sql<{ punched_at: unknown }>`
          select punched_at from attendances
          where user_id = ${row.user_id}
            and type = 'in'
            and punched_at >= ${day}::date
            and punched_at < (${day}::date + interval '1 day')
            and status in ('valid', 'corrected')
          order by punched_at asc
          limit 1
        `;
        const isEarliest = !existing[0] || new Date(punchedAt).getTime() <= new Date(stamp(existing[0].punched_at)).getTime();
        if (isEarliest) {
          lateMinutes = Math.max(0, clock - hmToMinutes(settings.workStart));
        }
      }
      if (!sunday && row.punch_type === "out") {
        overtimeMinutes = Math.max(0, clock - hmToMinutes(settings.workEnd));
        overtimeStatus = overtimeMinutes >= settings.overtimeMinMinutes ? "pending" : "none";
      }
      await sql`
        insert into attendances (
          user_id, company_id, type, punched_at, status, nearest_name, location_source, note,
          late_minutes, overtime_minutes, overtime_status
        ) values (
          ${row.user_id}, ${profile.companyId}, ${row.punch_type}, ${punchedAt}::timestamptz,
          'corrected', 'Đơn đã duyệt', 'manual', ${`Đơn #${row.id}`},
          ${lateMinutes}, ${overtimeMinutes}, ${overtimeStatus}
        )
      `;
    }
    await sql`
      update correction_requests
      set status = ${data.decision},
          reviewed_by = ${profile.userId},
          reviewed_at = now(),
          review_note = ${data.reviewNote || null}
      where id = ${row.id} and status = 'pending'
    `;
    return { ok: true };
  });

export const listRankings = createServerFn({ method: "POST" })
  .validator((month: string) => assertMonth(month))
  .middleware([authMiddleware])
  .handler(async ({ context, data: month }): Promise<RankLists> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const companies = await sql<{ settings: unknown }>`
      select settings from companies where id = ${profile.companyId}
    `;
    const settings = readSettings(companies[0]?.settings);
    if (!settings.rankingsEnabled) return { enabled: false, consistent: [], earliest: [] };
    const { start, end } = monthRange(month);
    const rows = await sql<{
      user_id: string;
      full_name: string;
      type: "in" | "out";
      punched_at: unknown;
    }>`
      select a.user_id, p.full_name, a.type, a.punched_at
      from attendances a
      join profiles p on p.user_id = a.user_id
      where a.company_id = ${profile.companyId}
        and a.punched_at >= ${start}::timestamptz
        and a.punched_at < ${end}::timestamptz
        and a.status in ('valid', 'corrected')
        and a.type = 'in'
        and a.offsite = false
      order by a.punched_at asc
    `;
    const byUser = new Map<string, { userId: string; fullName: string; days: Map<string, string> }>();
    for (const row of rows) {
      const at = stamp(row.punched_at);
      const day = vnDateKey(at);
      const bucket = byUser.get(row.user_id) ?? { userId: row.user_id, fullName: row.full_name, days: new Map() };
      if (!bucket.days.has(day)) bucket.days.set(day, at);
      byUser.set(row.user_id, bucket);
    }
    const consistent: RankLists["consistent"] = [];
    const earliest: RankLists["earliest"] = [];
    for (const bucket of byUser.values()) {
      const times = [...bucket.days.values()];
      if (times.length === 0) continue;
      const onTime = times.filter((t) => {
        const late = Math.max(0, vnMinutes(t) - hmToMinutes(settings.workStart));
        return late < settings.lateMinutes;
      }).length;
      consistent.push({
        userId: bucket.userId,
        avatar: null,
        fullName: bucket.fullName,
        days: times.length,
        onTime,
        rate: onTime / times.length,
      });
      const avg = times.reduce((sum, t) => sum + vnMinutes(t), 0) / times.length;
      earliest.push({ userId: bucket.userId, avatar: null, fullName: bucket.fullName, avgMinutes: avg, days: times.length });
    }
    consistent.sort((a, b) => b.rate - a.rate || b.days - a.days || a.fullName.localeCompare(b.fullName, "vi"));
    earliest.sort((a, b) => a.avgMinutes - b.avgMinutes || b.days - a.days);
    const top = { consistent: consistent.slice(0, 8), earliest: earliest.slice(0, 8) };
    // Ảnh đại diện chỉ lấy cho những người có trong bảng (tối đa 16), không kéo cả công ty.
    const ids = [...new Set([...top.consistent, ...top.earliest].map((r) => r.userId))];
    if (ids.length) {
      const found = await Promise.all(
        ids.map(async (id) => {
          const r = await sql<{ avatar_data: string | null }>`select avatar_data from profiles where user_id = ${id}`;
          return [id, r[0]?.avatar_data ?? null] as const;
        }),
      );
      const map = new Map(found);
      for (const r of [...top.consistent, ...top.earliest]) r.avatar = map.get(r.userId) ?? null;
    }
    return { enabled: true, ...top };
  });

function csvCell(value: string): string {
  // Ngăn CSV injection: ô bắt đầu bằng = + - @ được prefix bằng dấu nháy đơn
  const safe = /^[=+\-@]/.test(value) ? "'" + value : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const exportTimesheet = createServerFn({ method: "POST" })
  .validator((month: string) => assertMonth(month))
  .middleware([authMiddleware])
  .handler(async ({ context, data: month }): Promise<{ filename: string; csv: string }> => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Chỉ quản trị và người duyệt được tải bảng công");
    const sql = await getSql();
    const companies = await sql<{ settings: unknown }>`
      select settings from companies where id = ${profile.companyId}
    `;
    const settings = readSettings(companies[0]?.settings);
    const { start, end } = monthRange(month);
    const rows = await sql<{
      full_name: string;
      employee_code: string | null;
      department: string | null;
      job_title: string | null;
      phone: string | null;
      type: "in" | "out";
      punched_at: unknown;
      offsite: boolean;
      late_minutes: number;
      overtime_minutes: number;
      overtime_status: OvertimeStatus;
    }>`
      select p.full_name, p.employee_code, p.department, p.job_title, p.phone,
             a.type, a.punched_at, a.offsite, a.late_minutes, a.overtime_minutes, a.overtime_status
      from attendances a
      join profiles p on p.user_id = a.user_id
      where a.company_id = ${profile.companyId}
        and a.punched_at >= ${start}::timestamptz
        and a.punched_at < ${end}::timestamptz
        and a.status in ('valid', 'corrected')
      order by p.full_name asc, a.punched_at asc
    `;
    const holidayRows = await sql<{ date: unknown }>`
      select date from holidays where company_id = ${profile.companyId}
        and date >= ${start}::date and date < ${end}::date
    `;
    const holidaySet = new Set(holidayRows.map((r) => dateOnly(r.date)));
    const otReqRows = await sql<{ full_name: string; work_date: unknown; minutes: number }>`
      select p.full_name, o.work_date, o.minutes from overtime_requests o
      join profiles p on p.user_id = o.user_id
      where o.company_id = ${profile.companyId} and o.status = 'approved'
        and o.work_date >= ${start.slice(0, 10)}::date and o.work_date < ${end.slice(0, 10)}::date
    `;
    const extraByDay = new Map<string, number>();
    for (const r of otReqRows) {
      const k = `${r.full_name}\u0000${dateOnly(r.work_date)}`;
      extraByDay.set(k, (extraByDay.get(k) ?? 0) + Number(r.minutes));
    }
    const days = new Map<
      string,
      {
        name: string;
        code: string;
        department: string;
        title: string;
        phone: string;
        day: string;
        punches: { type: "in" | "out"; at: string; offsite: boolean; lateMinutes: number; overtimeMinutes: number; overtimeStatus: OvertimeStatus }[];
      }
    >();
    for (const row of rows) {
      const at = stamp(row.punched_at);
      const day = vnDateKey(at);
      const key = `${row.full_name}\u0000${day}`;
      const bucket = days.get(key) ?? {
        name: row.full_name,
        code: row.employee_code ?? "",
        department: row.department ?? "",
        title: row.job_title ?? "",
        phone: row.phone ? displayPhone(row.phone) : "",
        day,
        punches: [],
      };
      bucket.punches.push({
        type: row.type,
        at,
        offsite: Boolean(row.offsite),
        lateMinutes: Number(row.late_minutes ?? 0),
        overtimeMinutes: Number(row.overtime_minutes ?? 0),
        overtimeStatus: row.overtime_status ?? "none",
      });
      days.set(key, bucket);
    }
    const header = [
      "Họ tên",
      "Mã nhân viên",
      "Phòng ban",
      "Chức danh",
      "Số điện thoại",
      "Ngày",
      "Giờ vào",
      "Giờ ra",
      "Số giờ",
      "Công",
      "Loại ngày",
      "Hệ số",
      "Công quy đổi",
      "Đi muộn (phút)",
      "Tăng ca",
      "Tăng ca được tính",
      "Trạng thái tăng ca",
      "Ra sớm",
      "Ngoài điểm",
      "Thiếu giờ ra",
    ];
    const lines = [[...header].map(csvCell).join(",")];
    const sorted = [...days.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "vi") || a.day.localeCompare(b.day),
    );
    for (const bucket of sorted) {
      const firstIn = bucket.punches.find((punch) => punch.type === "in");
      const lastOut = [...bucket.punches].reverse().find((punch) => punch.type === "out");
      const isHoliday = holidaySet.has(bucket.day);
      const isSunday = !isHoliday && vnWeekday(bucket.day) === 0;
      // Giờ làm: trừ nghỉ trưa; ngày thường chỉ tính trong khung giờ ca (ra muộn là tăng ca, tính riêng)
      const workedDay = sumWorked(bucket.punches, { schedule: scheduleOf(settings), clip: !isHoliday && !isSunday });
      const hours = workedDay > 0 ? minutesToHm(workedDay) : "";
      const lateMinutes = firstIn?.lateMinutes ?? 0;
      const overtimeMinutes = lastOut?.overtimeMinutes ?? 0;
      const overtimeStatus = lastOut?.overtimeStatus ?? "none";
      const extraOt = extraByDay.get(`${bucket.name}\u0000${bucket.day}`) ?? 0;
      const countedTotal = (overtimeStatus === "approved" ? overtimeMinutes : 0) + extraOt;
      const counted = countedTotal > 0 ? minutesToHm(countedTotal) : "";
      const early =
        lastOut && vnWeekday(bucket.day) !== 0 && isEarlyOut(lastOut.at, settings.workEnd) ? "Có" : "Không";
      const offsite = bucket.punches.some((punch) => punch.offsite) ? "Có" : "Không";
      const missingOut = firstIn && !lastOut ? "Có" : "Không";
      const openToday = bucket.day === vnDateKey() && firstIn && !lastOut;
      const congDay = openToday ? null : congOf(workedDay, settings.fullDayMinutes, settings.halfDayMinutes);
      const rate = isHoliday ? settings.holidayRate : isSunday ? settings.sundayRate : 1;
      // Chủ nhật/lễ chỉ được nhân hệ số khi tăng ca đã duyệt; chưa duyệt thì chưa tính.
      const converted =
        congDay == null ? "" : isHoliday || isSunday ? (overtimeStatus === "approved" ? String(Math.round(congDay * rate * 100) / 100) : "0") : String(congDay);
      lines.push(
        [
          bucket.name,
          bucket.code,
          bucket.department,
          bucket.title,
          bucket.phone,
          bucket.day,
          firstIn ? vnTimeExport(firstIn.at) : "",
          lastOut ? vnTimeExport(lastOut.at) : "",
          hours,
          congDay == null ? "" : String(congDay),
          isHoliday ? "Lễ" : isSunday ? "Chủ nhật" : "Thường",
          rate === 1 ? "" : String(rate).replace(".", ","),
          converted,
          firstIn && lateMinutes >= settings.lateMinutes ? String(lateMinutes) : "",
          lastOut && overtimeMinutes > 0 ? minutesToHm(overtimeMinutes) : "",
          counted,
          lastOut ? overtimeLabel(overtimeStatus, overtimeMinutes) : "",
          lastOut ? early : "",
          offsite,
          missingOut,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return { filename: `bang-cong-${month}.csv`, csv: `\uFEFF${lines.join("\r\n")}` };
  });

function overtimeLabel(status: OvertimeStatus, minutes: number): string {
  if (status === "approved") return "Đã duyệt";
  if (status === "rejected") return "Từ chối";
  if (status === "pending") return "Chờ duyệt";
  if (minutes > 0) return "Dưới 1 giờ";
  return "Không";
}

function vnTimeExport(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export const reviewOvertime = createServerFn({ method: "POST" })
  .validator((input: { id: number; decision: "approved" | "rejected" }) => {
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Lần tăng ca không hợp lệ");
    if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Quyết định không hợp lệ");
    return { id, decision: input.decision };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Bạn không có quyền duyệt tăng ca");
    const sql = await getSql();
    const rows = await sql<{ user_id: string; overtime_status: string; punched_at: unknown }>`
      select user_id, overtime_status, punched_at from attendances
      where id = ${data.id} and company_id = ${profile.companyId}
    `;
    const row = rows[0];
    if (!row || row.overtime_status !== "pending") throw new Error("Lần tăng ca này không còn chờ duyệt");
    if (row.user_id === profile.userId) {
        const only = await isOnlyReviewer(profile.companyId, profile.userId);
        if (!only) throw new Error("Không tự duyệt tăng ca của mình");
      }
    await assertMonthOpen(profile.companyId, vnDateKey(stamp(row.punched_at)));
    await sql`
      update attendances
      set overtime_status = ${data.decision},
          overtime_reviewed_by = ${profile.userId},
          overtime_reviewed_at = now()
      where id = ${data.id} and company_id = ${profile.companyId} and overtime_status = 'pending'
    `;
    return { ok: true };
  });

/** Nhân viên tự sửa: chỉ họ tên và ảnh đại diện. Mã NV, phòng ban, chức danh, ngày vào làm do quản trị quyết định (adminUpdateProfile). */
export const updateProfile = createServerFn({ method: "POST" })
  .validator((input: { avatar: string }) => {
    const avatar = input.avatar.trim();
    if (!avatar || !avatar.startsWith("data:image/jpeg;base64,") || avatar.length > 180_000) {
      throw new Error("Ảnh đại diện quá nặng hoặc không đúng định dạng.");
    }
    return { avatar };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    await sql`
      update profiles
      set avatar_data = ${data.avatar}
      where user_id = ${profile.userId}
    `;
    return { ok: true };
  });

export const adminUpdateProfile = createServerFn({ method: "POST" })
  .validator(
    (input: {
      userId: string;
      fullName: string;
      employeeCode: string;
      department: string;
      jobTitle: string;
      startedOn: string;
      isActive: boolean;
      endedOn: string;
    }) => {
      const userId = input.userId.trim();
      if (!userId) throw new Error("Thiếu nhân viên");
      const fullName = input.fullName.trim().slice(0, 80);
      if (fullName.length < 2) throw new Error("Tên cần ít nhất 2 ký tự");
      const employeeCode = input.employeeCode.trim().slice(0, 20);
      const department = input.department.trim().slice(0, 60);
      const jobTitle = input.jobTitle.trim().slice(0, 60);
      const startedOn = input.startedOn.trim();
      if (startedOn && !/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) throw new Error("Ngày vào làm chưa đúng");
      const endedOn = input.endedOn.trim();
      if (endedOn && !/^\d{4}-\d{2}-\d{2}$/.test(endedOn)) throw new Error("Ngày nghỉ việc chưa đúng");
      const isActive = Boolean(input.isActive);
      // Nghỉ việc mà chưa ghi ngày thì lấy hôm nay; đi làm lại thì xóa ngày nghỉ.
      return { userId, fullName, employeeCode, department, jobTitle, startedOn, isActive, endedOn: isActive ? "" : endedOn || vnDateKey() };
    },
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được sửa hồ sơ nhân viên");
    const sql = await getSql();
    await sql`
      update profiles
      set full_name = ${data.fullName},
          employee_code = ${data.employeeCode || null},
          department = ${data.department || null},
          job_title = ${data.jobTitle || null},
          started_on = ${data.startedOn || null}::date,
          is_active = ${data.isActive},
          ended_on = ${data.endedOn || null}::date
      where user_id = ${data.userId} and company_id = ${profile.companyId}
    `;
    return { ok: true };
  });

export const saveCompany = createServerFn({ method: "POST" })
  .validator((input: { name: string; settings: Settings }) => {
    const name = input.name.trim().slice(0, 80);
    if (name.length < 2) throw new Error("Tên công ty quá ngắn");
    const raw = input.settings as unknown as Record<string, unknown>;
    if (Number(raw.halfDayMinutes) >= Number(raw.fullDayMinutes)) throw new Error("Số giờ tính nửa công phải nhỏ hơn số giờ tính đủ công");
    const settings = readSettings(input.settings);
    return { name, settings };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được sửa cài đặt");
    const sql = await getSql();
    await sql`
      update companies
      set name = ${data.name}, settings = ${JSON.stringify(data.settings)}::jsonb
      where id = ${profile.companyId}
    `;
    return { ok: true };
  });

export const saveLocation = createServerFn({ method: "POST" })
  .validator(
    (input: {
      id: number | null;
      name: string;
      lat: number;
      lng: number;
      radiusMeters: number;
      isActive: boolean;
    }) => {
      const name = input.name.trim().slice(0, 80);
      if (name.length < 2) throw new Error("Đặt tên vị trí");
      if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) throw new Error("Vĩ độ không hợp lệ");
      if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) throw new Error("Kinh độ không hợp lệ");
      const radiusMeters = clampNum(input.radiusMeters, 30, 2000, 150);
      const id = input.id == null ? null : Number(input.id);
      if (id != null && (!Number.isInteger(id) || id <= 0)) throw new Error("Vị trí không hợp lệ");
      return { id, name, lat: input.lat, lng: input.lng, radiusMeters, isActive: Boolean(input.isActive) };
    },
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được sửa vị trí");
    const sql = await getSql();
    if (data.id == null) {
      await sql`
        insert into locations (company_id, name, lat, lng, radius_meters, is_active)
        values (${profile.companyId}, ${data.name}, ${data.lat}, ${data.lng}, ${data.radiusMeters}, ${data.isActive})
      `;
    } else {
      const updated = await sql`
        update locations
        set name = ${data.name}, lat = ${data.lat}, lng = ${data.lng},
            radius_meters = ${data.radiusMeters}, is_active = ${data.isActive}
        where id = ${data.id} and company_id = ${profile.companyId}
        returning id
      `;
      if (!updated[0]) throw new Error("Không tìm thấy vị trí");
    }
    return { ok: true };
  });

/** Mật khẩu 8 chữ số ngẫu nhiên: dễ đọc, dễ nhập cho người lớn tuổi (không lặp một số, không dãy liền). */
async function easyPassword(): Promise<string> {
  const { randomInt } = await import("node:crypto");
  for (;;) {
    const pin = String(randomInt(10_000_000, 100_000_000));
    if (/^(\d)\1+$/.test(pin)) continue;
    if ("0123456789".includes(pin) || "9876543210".includes(pin)) continue;
    return pin;
  }
}

export type NewEmployeeInput = {
  fullName: string;
  phone: string;
  employeeCode?: string;
  department?: string;
  jobTitle?: string;
  startedOn?: string;
};

export type NewEmployeeResult = {
  fullName: string;
  phone: string;
  ok: boolean;
  /** Chỉ có khi tạo thành công. Chỉ hiện một lần, hệ thống không lưu bản rõ. */
  password?: string;
  error?: string;
};

/** Quản trị tạo sẵn tài khoản cho nhân viên: nhân viên chỉ cần đăng nhập bằng số điện thoại và mật khẩu được cấp. */
export const adminCreateEmployees = createServerFn({ method: "POST" })
  .validator((input: { people: NewEmployeeInput[] }) => {
    if (!Array.isArray(input.people) || input.people.length === 0) throw new Error("Chưa có nhân viên nào");
    if (input.people.length > 100) throw new Error("Tối đa 100 người mỗi lần");
    return {
      people: input.people.map((p) => ({
        fullName: String(p.fullName ?? "").trim().slice(0, 80),
        phone: String(p.phone ?? "").trim(),
        employeeCode: String(p.employeeCode ?? "").trim().slice(0, 20),
        department: String(p.department ?? "").trim().slice(0, 60),
        jobTitle: String(p.jobTitle ?? "").trim().slice(0, 60),
        startedOn: String(p.startedOn ?? "").trim(),
      })),
    };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<NewEmployeeResult[]> => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được tạo tài khoản cho nhân viên");
    const sql = await getSql();
    const { auth } = await import("@/lib/auth/server");
    const ac = await auth.$context;
    const out: NewEmployeeResult[] = [];
    const seen = new Set<string>();
    for (const p of data.people) {
      const phone = normalizeVnPhone(p.phone);
      const shown = phone ? displayPhone(phone) : p.phone;
      const fail = (error: string) => out.push({ fullName: p.fullName, phone: shown, ok: false, error });
      if (p.fullName.length < 2) {
        fail("Thiếu họ tên");
        continue;
      }
      if (!phone) {
        fail("Số điện thoại chưa đúng");
        continue;
      }
      if (p.startedOn && !/^\d{4}-\d{2}-\d{2}$/.test(p.startedOn)) {
        fail("Ngày vào làm chưa đúng");
        continue;
      }
      if (seen.has(phone)) {
        fail("Số bị trùng trong danh sách");
        continue;
      }
      seen.add(phone);
      try {
        const email = phoneLoginEmail(phone);
        if (await ac.internalAdapter.findUserByEmail(email)) {
          fail("Số này đã có tài khoản");
          continue;
        }
        const password = await easyPassword();
        const hash = await ac.password.hash(password);
        const user = await ac.internalAdapter.createUser({ email, name: p.fullName, emailVerified: false });
        if (!user) {
          fail("Không tạo được tài khoản");
          continue;
        }
        await ac.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
        await sql`
          insert into profiles (user_id, company_id, full_name, email, phone, role, employee_code, department, job_title, started_on)
          values (${user.id}, ${profile.companyId}, ${p.fullName}, ${email}, ${phone}, 'employee',
                  ${p.employeeCode || null}, ${p.department || null}, ${p.jobTitle || null}, ${p.startedOn || vnDateKey()}::date)
          on conflict (user_id) do nothing
        `;
        out.push({ fullName: p.fullName, phone: shown, ok: true, password });
      } catch (err) {
        fail(err instanceof Error ? err.message : "Không tạo được tài khoản");
      }
    }
    return out;
  });

/** Quản trị cấp lại mật khẩu mới cho nhân viên (quên hoặc mất). Các máy đang đăng nhập bị đăng xuất. */
export const adminResetPassword = createServerFn({ method: "POST" })
  .validator((input: { userId: string }) => {
    if (!input.userId || input.userId.length > 80) throw new Error("Người dùng không hợp lệ");
    return { userId: input.userId };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ password: string }> => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được cấp lại mật khẩu");
    const sql = await getSql();
    const rows = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${data.userId} and company_id = ${profile.companyId}
    `;
    if (!rows[0]) throw new Error("Không tìm thấy nhân viên");
    const { auth } = await import("@/lib/auth/server");
    const ac = await auth.$context;
    const password = await easyPassword();
    await ac.internalAdapter.updatePassword(data.userId, await ac.password.hash(password));
    await ac.internalAdapter.deleteUserSessions(data.userId);
    return { password };
  });

/** Ngày công ty giữ nhân viên đã nghỉ trong danh sách trước khi tự ẩn (dữ liệu chấm công và bảng công cũ vẫn giữ). */
export const LEFT_VISIBLE_DAYS = 15;

/** Tích "nghỉ việc" (left = true) hoặc bỏ tích để cho đi làm lại. */
export const setEmployeeLeft = createServerFn({ method: "POST" })
  .validator((input: { userId: string; left: boolean }) => {
    if (!input.userId || input.userId.length > 80) throw new Error("Người dùng không hợp lệ");
    return { userId: input.userId, left: Boolean(input.left) };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được cho nhân viên nghỉ việc");
    if (data.left && data.userId === profile.userId) throw new Error("Không thể tự cho mình nghỉ việc.");
    const sql = await getSql();
    const today = vnDateKey();
    await sql`
      update profiles
      set is_active = ${!data.left},
          ended_on = ${data.left ? today : null}::date
      where user_id = ${data.userId} and company_id = ${profile.companyId}
    `;
    return { ok: true };
  });

export const setRole = createServerFn({ method: "POST" })
  .validator((input: { userId: string; role: Role }) => {
    if (!input.userId || input.userId.length > 80) throw new Error("Người dùng không hợp lệ");
    if (input.role !== "employee" && input.role !== "approver" && input.role !== "admin") {
      throw new Error("Vai trò không hợp lệ");
    }
    return input;
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được đổi vai trò");
    const sql = await getSql();
    if (data.userId === profile.userId && data.role !== "admin") {
      const admins = await sql<{ n: number }>`
        select count(*)::int as n from profiles
        where company_id = ${profile.companyId} and role = 'admin'
      `;
      if (Number(admins[0]?.n ?? 0) <= 1) throw new Error("Cần giữ ít nhất một quản trị.");
    }
    if (data.role === "approver") {
      const approvers = await sql<{ n: number }>`
        select count(*)::int as n from profiles
        where company_id = ${profile.companyId}
          and role = 'approver'
          and user_id <> ${data.userId}
      `;
      if (Number(approvers[0]?.n ?? 0) >= 2) {
        throw new Error("Chỉ để một hoặc hai người duyệt.");
      }
    }
    const updated = await sql`
      update profiles set role = ${data.role}
      where user_id = ${data.userId} and company_id = ${profile.companyId}
      returning user_id
    `;
    if (!updated[0]) throw new Error("Không tìm thấy nhân viên");
    return { ok: true };
  });

export const getMonthGrid = createServerFn({ method: "POST" })
  .validator((month: string) => assertMonth(month))
  .middleware([authMiddleware])
  .handler(async ({ context, data: month }): Promise<MonthGrid> => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Chỉ quản trị và người duyệt xem được bảng công");
    const sql = await getSql();
    const { start, end } = monthRange(month);
    const people = await sql<{
      user_id: string;
      full_name: string;
      employee_code: string | null;
      department: string | null;
      role: Role;
      started_on: unknown;
      ended_on: unknown;
      is_active: boolean;
    }>`
      select user_id, full_name, employee_code, department, role, started_on, ended_on, is_active
      from profiles where company_id = ${profile.companyId}
      order by full_name asc
    `;
    const rows = await sql<{
      id: number;
      user_id: string;
      type: "in" | "out";
      punched_at: unknown;
      status: "valid" | "corrected";
      nearest_name: string | null;
      distance_meters: number | null;
      offsite: boolean;
      late_minutes: number;
      overtime_minutes: number;
      overtime_status: OvertimeStatus;
      has_photo: boolean;
    }>`
      select id, user_id, type, punched_at, status, nearest_name, distance_meters, offsite,
             late_minutes, overtime_minutes, overtime_status,
             (photo_data is not null and photo_data <> '') as has_photo
      from attendances
      where company_id = ${profile.companyId}
        and punched_at >= ${start}::timestamptz
        and punched_at < ${end}::timestamptz
        and status in ('valid', 'corrected')
      order by punched_at asc
    `;
    const punches: MonthGrid["punches"] = {};
    for (const row of rows) {
      const at = stamp(row.punched_at);
      const day = vnDateKey(at);
      const item: MonthPunch = {
        id: Number(row.id),
        type: row.type,
        at,
        status: row.status,
        offsite: Boolean(row.offsite),
        lateMinutes: Number(row.late_minutes ?? 0),
        overtimeMinutes: Number(row.overtime_minutes ?? 0),
        overtimeStatus: row.overtime_status ?? "none",
        nearestName: row.nearest_name,
        distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
        hasPhoto: Boolean(row.has_photo),
      };
      ((punches[row.user_id] ??= {})[day] ??= []).push(item);
    }
    const locks = await sql<{ locked_at: unknown; full_name: string | null }>`
      select l.locked_at, p.full_name
      from timesheet_locks l left join profiles p on p.user_id = l.locked_by
      where l.company_id = ${profile.companyId} and l.month = ${month}
    `;
    const holidayRows = await sql<{ date: unknown; name: string }>`
      select date, name from holidays where company_id = ${profile.companyId}
        and date >= ${start}::date and date < ${end}::date
    `;
    const leaveRows = await sql<{ user_id: string; leave_date: unknown; kind: string }>`
      select user_id, leave_date, kind from leave_requests
      where company_id = ${profile.companyId} and status = 'approved'
        and leave_date >= ${start}::date and leave_date < ${end}::date
    `;
    const holidays = holidayRows.map(r => dateOnly(r.date));
    const extraOt = await loadExtraOt(sql, profile.companyId, start.slice(0, 10), end.slice(0, 10));
    const leaves: Record<string, Record<string, string>> = {};
    for (const r of leaveRows) {
      const d = dateOnly(r.leave_date);
      ((leaves[r.user_id] ??= {})[d] = r.kind);
    }
    return {
      month,
      todayKey: vnDateKey(),
      people: people.map((p) => ({
        userId: p.user_id,
        fullName: p.full_name,
        employeeCode: p.employee_code,
        department: p.department,
        role: p.role,
        startedOn: p.started_on ? dateOnly(p.started_on) : null,
        endedOn: p.ended_on ? dateOnly(p.ended_on) : null,
        isActive: Boolean(p.is_active),
      })),
      punches,
      holidays,
      leaves,
      extraOt,
      lock: locks[0]
        ? { lockedAt: stamp(locks[0].locked_at), lockedByName: locks[0].full_name ?? "Quản trị" }
        : null,
    };
  });

const HISTORY_ROW_LIMIT = 20000;

function assertRange(input: { from: string; to: string }): { from: string; to: string } {
  const ok = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ok(input?.from) || !ok(input?.to)) throw new Error("Khoảng ngày không hợp lệ");
  if (input.from > input.to) throw new Error("Ngày bắt đầu phải trước ngày kết thúc");
  const days = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86400000 + 1;
  if (days > HISTORY_MAX_DAYS) throw new Error(`Chỉ xem tối đa ${HISTORY_MAX_DAYS} ngày mỗi lần`);
  return { from: input.from, to: input.to };
}

/** Toàn bộ lịch sử chấm công của công ty trong khoảng ngày — chỉ quản trị và người duyệt. */
export const getHistory = createServerFn({ method: "POST" })
  .validator((input: { from: string; to: string }) => assertRange(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<HistoryData> => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Chỉ quản trị và người duyệt xem được lịch sử chấm công");
    const sql = await getSql();
    const start = dayRange(data.from).start;
    const end = dayRange(data.to).end;
    const people = await sql<{
      user_id: string;
      full_name: string;
      employee_code: string | null;
      department: string | null;
      role: Role;
      started_on: unknown;
      ended_on: unknown;
      is_active: boolean;
    }>`
      select user_id, full_name, employee_code, department, role, started_on, ended_on, is_active
      from profiles where company_id = ${profile.companyId}
      order by full_name asc
    `;
    const rows = await sql<{
      id: number;
      user_id: string;
      type: "in" | "out";
      punched_at: unknown;
      status: "valid" | "corrected";
      nearest_name: string | null;
      distance_meters: number | null;
      offsite: boolean;
      late_minutes: number;
      overtime_minutes: number;
      overtime_status: OvertimeStatus;
      has_photo: boolean;
    }>`
      select id, user_id, type, punched_at, status, nearest_name, distance_meters, offsite,
             late_minutes, overtime_minutes, overtime_status,
             (photo_data is not null and photo_data <> '') as has_photo
      from attendances
      where company_id = ${profile.companyId}
        and punched_at >= ${start}::timestamptz
        and punched_at < ${end}::timestamptz
        and status in ('valid', 'corrected')
      order by punched_at asc
      limit ${HISTORY_ROW_LIMIT + 1}
    `;
    const truncated = rows.length > HISTORY_ROW_LIMIT;
    const punches: HistoryData["punches"] = {};
    for (const row of rows.slice(0, HISTORY_ROW_LIMIT)) {
      const at = stamp(row.punched_at);
      const item: MonthPunch = {
        id: Number(row.id),
        type: row.type,
        at,
        status: row.status,
        offsite: Boolean(row.offsite),
        lateMinutes: Number(row.late_minutes ?? 0),
        overtimeMinutes: Number(row.overtime_minutes ?? 0),
        overtimeStatus: row.overtime_status ?? "none",
        nearestName: row.nearest_name,
        distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
        hasPhoto: Boolean(row.has_photo),
      };
      ((punches[row.user_id] ??= {})[vnDateKey(at)] ??= []).push(item);
    }
    const holidayRows = await sql<{ date: unknown }>`
      select date from holidays where company_id = ${profile.companyId}
        and date >= ${data.from}::date and date <= ${data.to}::date
    `;
    const leaveRows = await sql<{ user_id: string; leave_date: unknown; kind: string }>`
      select user_id, leave_date, kind from leave_requests
      where company_id = ${profile.companyId} and status = 'approved'
        and leave_date >= ${data.from}::date and leave_date <= ${data.to}::date
    `;
    const leaves: HistoryData["leaves"] = {};
    for (const r of leaveRows) (leaves[r.user_id] ??= {})[dateOnly(r.leave_date)] = r.kind;
    const extraOt = await loadExtraOt(sql, profile.companyId, data.from, dayRange(data.to).end.slice(0, 10));
    const lockRows = await sql<{ month: string }>`
      select month from timesheet_locks
      where company_id = ${profile.companyId} and month >= ${data.from.slice(0, 7)} and month <= ${data.to.slice(0, 7)}
    `;
    return {
      from: data.from,
      to: data.to,
      todayKey: vnDateKey(),
      people: people.map((p) => ({
        userId: p.user_id,
        fullName: p.full_name,
        employeeCode: p.employee_code,
        department: p.department,
        role: p.role,
        startedOn: p.started_on ? dateOnly(p.started_on) : null,
        endedOn: p.ended_on ? dateOnly(p.ended_on) : null,
        isActive: Boolean(p.is_active),
      })),
      punches,
      holidays: holidayRows.map((r) => dateOnly(r.date)),
      leaves,
      extraOt,
      lockedMonths: lockRows.map((r) => r.month),
      truncated,
    };
  });

/** Nhật ký duyệt: đơn sửa công, đơn nghỉ, tăng ca — ai xin, ai duyệt, khi nào. */
export const listAudit = createServerFn({ method: "POST" })
  .validator((input: { from: string; to: string }) => assertRange(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<AuditEvent[]> => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Chỉ quản trị và người duyệt xem được nhật ký duyệt");
    const sql = await getSql();
    const start = dayRange(data.from).start;
    const end = dayRange(data.to).end;
    const corr = await sql<{
      id: number; user_id: string; full_name: string; attendance_date: unknown; punch_type: "in" | "out";
      requested_time: string; kind: string; note: string; status: "pending" | "approved" | "rejected";
      review_note: string | null; created_at: unknown; reviewed_at: unknown; reviewer_name: string | null;
    }>`
      select c.id, c.user_id, p.full_name, c.attendance_date, c.punch_type, c.requested_time, c.kind, c.note,
             c.status, c.review_note, c.created_at, c.reviewed_at, r.full_name as reviewer_name
      from correction_requests c
      join profiles p on p.user_id = c.user_id
      left join profiles r on r.user_id = c.reviewed_by
      where c.company_id = ${profile.companyId}
        and c.attendance_date >= ${data.from}::date and c.attendance_date <= ${data.to}::date
      order by c.created_at desc limit 2000
    `;
    const leave = await sql<{
      id: number; user_id: string; full_name: string; leave_date: unknown; kind: string; note: string;
      status: "pending" | "approved" | "rejected"; review_note: string | null; created_at: unknown;
      reviewed_at: unknown; reviewer_name: string | null;
    }>`
      select l.id, l.user_id, p.full_name, l.leave_date, l.kind, l.note, l.status, l.review_note,
             l.created_at, l.reviewed_at, r.full_name as reviewer_name
      from leave_requests l
      join profiles p on p.user_id = l.user_id
      left join profiles r on r.user_id = l.reviewed_by
      where l.company_id = ${profile.companyId}
        and l.leave_date >= ${data.from}::date and l.leave_date <= ${data.to}::date
      order by l.created_at desc limit 2000
    `;
    const ot = await sql<{
      id: number; user_id: string; full_name: string; punched_at: unknown; overtime_minutes: number;
      overtime_status: "approved" | "rejected" | "pending"; reviewed_at: unknown; reviewer_name: string | null;
    }>`
      select a.id, a.user_id, p.full_name, a.punched_at, a.overtime_minutes, a.overtime_status,
             a.overtime_reviewed_at as reviewed_at, r.full_name as reviewer_name
      from attendances a
      join profiles p on p.user_id = a.user_id
      left join profiles r on r.user_id = a.overtime_reviewed_by
      where a.company_id = ${profile.companyId}
        and a.overtime_status in ('pending', 'approved', 'rejected')
        and a.punched_at >= ${start}::timestamptz and a.punched_at < ${end}::timestamptz
      order by a.punched_at desc limit 2000
    `;
    const otReq = await sql<{
      id: number; user_id: string; full_name: string; work_date: unknown; start_time: string; end_time: string;
      minutes: number; note: string; status: "pending" | "approved" | "rejected"; review_note: string | null;
      created_at: unknown; reviewed_at: unknown; reviewer_name: string | null;
    }>`
      select o.id, o.user_id, p.full_name, o.work_date, o.start_time, o.end_time, o.minutes, o.note, o.status,
             o.review_note, o.created_at, o.reviewed_at, r.full_name as reviewer_name
      from overtime_requests o
      join profiles p on p.user_id = o.user_id
      left join profiles r on r.user_id = o.reviewed_by
      where o.company_id = ${profile.companyId}
        and o.work_date >= ${data.from}::date and o.work_date <= ${data.to}::date
      order by o.created_at desc limit 2000
    `;
    const KIND: Record<string, string> = { quen: "Quên chấm", gps: "Lỗi GPS", congtac: "Đi công tác", khac: "Khác" };
    const LEAVE: Record<string, string> = { phep: "Nghỉ phép", om: "Nghỉ ốm", thaisan: "Thai sản", khac: "Nghỉ khác" };
    const events: AuditEvent[] = [
      ...corr.map((c): AuditEvent => ({
        key: `c${c.id}`, kind: "correction", status: c.status, userId: c.user_id, fullName: c.full_name,
        date: dateOnly(c.attendance_date),
        subject: `${KIND[c.kind] ?? c.kind} · xin sửa giờ ${c.punch_type === "in" ? "vào" : "ra"} ${c.requested_time}`,
        note: c.note, reviewNote: c.review_note, createdAt: stamp(c.created_at),
        reviewedByName: c.reviewer_name, reviewedAt: c.reviewed_at ? stamp(c.reviewed_at) : null,
      })),
      ...leave.map((l): AuditEvent => ({
        key: `l${l.id}`, kind: "leave", status: l.status, userId: l.user_id, fullName: l.full_name,
        date: dateOnly(l.leave_date), subject: LEAVE[l.kind] ?? "Nghỉ",
        note: l.note, reviewNote: l.review_note, createdAt: stamp(l.created_at),
        reviewedByName: l.reviewer_name, reviewedAt: l.reviewed_at ? stamp(l.reviewed_at) : null,
      })),
      ...otReq.map((o): AuditEvent => ({
        key: `r${o.id}`, kind: "overtime", status: o.status, userId: o.user_id, fullName: o.full_name,
        date: dateOnly(o.work_date), subject: `Đơn tăng ca ${o.start_time}–${o.end_time} (${minutesToHm(Number(o.minutes))})`,
        note: o.note, reviewNote: o.review_note, createdAt: stamp(o.created_at),
        reviewedByName: o.reviewer_name, reviewedAt: o.reviewed_at ? stamp(o.reviewed_at) : null,
      })),
      ...ot.map((o): AuditEvent => ({
        key: `o${o.id}`, kind: "overtime", status: o.overtime_status, userId: o.user_id, fullName: o.full_name,
        date: vnDateKey(stamp(o.punched_at)), subject: `Tăng ca ${minutesToHm(Number(o.overtime_minutes))}`,
        note: "", reviewNote: null, createdAt: stamp(o.punched_at),
        reviewedByName: o.reviewer_name, reviewedAt: o.reviewed_at ? stamp(o.reviewed_at) : null,
      })),
    ];
    events.sort((a, b) => (b.reviewedAt ?? b.createdAt ?? "").localeCompare(a.reviewedAt ?? a.createdAt ?? ""));
    return events;
  });

export const lockMonth = createServerFn({ method: "POST" })
  .validator((input: { month: string; locked: boolean }) => ({
    month: assertMonth(input.month),
    locked: input.locked === true,
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị mới chốt hoặc mở khóa công");
    const sql = await getSql();
    if (data.locked) {
      if (data.month >= vnDateKey().slice(0, 7)) throw new Error("Chỉ chốt công cho tháng đã kết thúc");
      await sql`
        insert into timesheet_locks (company_id, month, locked_by) values (${profile.companyId}, ${data.month}, ${profile.userId})
        on conflict (company_id, month) do nothing
      `;
    } else {
      await sql`delete from timesheet_locks where company_id = ${profile.companyId} and month = ${data.month}`;
    }
    return { ok: true };
  });

export const getInviteCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ code: string }> => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị xem được mã mời");
    const { ensureInviteCode, formatInvite } = await import("@/lib/auth/invite.server");
    return { code: formatInvite(await ensureInviteCode(profile.companyId)) };
  });

export const regenerateInviteCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ code: string }> => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị đổi được mã mời");
    const { formatInvite, regenerateInviteCode: regenerate } = await import("@/lib/auth/invite.server");
    return { code: formatInvite(await regenerate(profile.companyId)) };
  });


export const createLeaveRequest = createServerFn({ method: "POST" })
  .validator((input: { leaveDate: string; kind: string; note: string }) => {
    const leaveDate = input.leaveDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) throw new Error("Ngày chưa đúng");
    const kind = input.kind.trim();
    if (!["phep", "om", "thaisan", "khac"].includes(kind)) throw new Error("Loại nghỉ không hợp lệ");
    const note = input.note.trim().slice(0, 300);
    if (note.length < 3) throw new Error("Cần ghi chú lý do");
    return { leaveDate, kind, note };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    await assertMonthOpen(profile.companyId, data.leaveDate);
    const sql = await getSql();
    const dup = await sql<{ id: number }>`
      select id from leave_requests
      where user_id = ${profile.userId} and leave_date = ${data.leaveDate}::date and status in ('pending', 'approved')
      limit 1
    `;
    if (dup.length) throw new Error("Bạn đã có đơn nghỉ cho ngày này");
    await sql`
      insert into leave_requests (user_id, company_id, leave_date, kind, note)
      values (${profile.userId}, ${profile.companyId}, ${data.leaveDate}::date, ${data.kind}, ${data.note})
    `;
    return { ok: true };
  });

export const listLeaves = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<LeaveRow[]> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      user_id: string;
      full_name: string;
      leave_date: unknown;
      kind: LeaveKind;
      note: string;
      status: "pending" | "approved" | "rejected";
      review_note: string | null;
      created_at: unknown;
      reviewed_at: unknown;
      reviewer_name: string | null;
    }>`
      select l.id, l.user_id, p.full_name, l.leave_date, l.kind, l.note, l.status, l.review_note,
             l.created_at, l.reviewed_at, r.full_name as reviewer_name
      from leave_requests l
      join profiles p on p.user_id = l.user_id
      left join profiles r on r.user_id = l.reviewed_by
      where l.company_id = ${profile.companyId}
        and (${canReview(profile.role)} or l.user_id = ${profile.userId})
      order by case when l.status = 'pending' then 0 else 1 end, l.created_at desc
      limit 80
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id,
      fullName: row.full_name,
      leaveDate: dateOnly(row.leave_date),
      kind: row.kind,
      note: row.note,
      status: row.status,
      reviewNote: row.review_note,
      createdAt: stamp(row.created_at),
      reviewedByName: row.reviewer_name,
      reviewedAt: row.reviewed_at ? stamp(row.reviewed_at) : null,
    }));
  });

export const createOvertimeRequest = createServerFn({ method: "POST" })
  .validator((input: { workDate: string; startTime: string; endTime: string; note: string }) => {
    const workDate = input.workDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new Error("Ngày chưa đúng");
    if (!isHm(input.startTime) || !isHm(input.endTime)) throw new Error("Giờ chưa đúng");
    const note = input.note.trim().slice(0, 300);
    if (note.length < 3) throw new Error("Cần ghi chú việc đã làm");
    return { workDate, startTime: input.startTime, endTime: input.endTime, note };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const companies = await sql<{ settings: unknown }>`select settings from companies where id = ${profile.companyId}`;
    const settings = readSettings(companies[0]?.settings);
    const today = vnDateKey();
    const earliest = vnDateKey(new Date(Date.now() - 31 * 86_400_000));
    const latest = vnDateKey(new Date(Date.now() + 7 * 86_400_000));
    if (data.workDate < earliest) throw new Error("Chỉ xin tăng ca trong vòng 31 ngày gần đây");
    if (data.workDate > latest) throw new Error("Chỉ xin trước tối đa 7 ngày");
    void today;
    await assertMonthOpen(profile.companyId, data.workDate);
    if (vnWeekday(data.workDate) === 0 || (await isHolidayDay(profile.companyId, data.workDate))) {
      throw new Error("Chủ nhật và ngày lễ: cứ chấm vào/ra như bình thường, hệ thống tự tính tăng ca. Không cần gửi đơn.");
    }
    if (hmToMinutes(data.endTime) <= hmToMinutes(data.startTime)) throw new Error("Giờ kết thúc phải sau giờ bắt đầu");
    const minutes = countableOvertime(data.startTime, data.endTime, scheduleOf(settings));
    if (minutes < settings.overtimeMinMinutes) {
      throw new Error(
        `Đơn tăng ca chỉ tính phần giờ nghỉ trưa (${settings.lunchStart}–${settings.lunchEnd}). Phần trong giờ làm đã tính công, phần sau ${settings.workEnd} tự tính khi chấm ra. Cần từ ${settings.overtimeMinMinutes} phút trở lên.`,
      );
    }
    const clash = await sql<{ start_time: string; end_time: string }>`
      select start_time, end_time from overtime_requests
      where user_id = ${profile.userId} and work_date = ${data.workDate}::date and status in ('pending', 'approved')
    `;
    for (const c of clash) {
      if (hmToMinutes(c.start_time) < hmToMinutes(data.endTime) && hmToMinutes(data.startTime) < hmToMinutes(c.end_time)) {
        throw new Error(`Đã có đơn tăng ca ${c.start_time}–${c.end_time} trùng giờ này`);
      }
    }
    await sql`
      insert into overtime_requests (user_id, company_id, work_date, start_time, end_time, minutes, note)
      values (${profile.userId}, ${profile.companyId}, ${data.workDate}::date, ${data.startTime}, ${data.endTime}, ${minutes}, ${data.note})
    `;
    return { ok: true, minutes };
  });

export const listOvertimeRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OvertimeRequestRow[]> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: number; user_id: string; full_name: string; work_date: unknown; start_time: string; end_time: string;
      minutes: number; note: string; status: "pending" | "approved" | "rejected"; review_note: string | null;
      created_at: unknown; reviewed_at: unknown; reviewer_name: string | null;
    }>`
      select o.id, o.user_id, p.full_name, o.work_date, o.start_time, o.end_time, o.minutes, o.note, o.status,
             o.review_note, o.created_at, o.reviewed_at, r.full_name as reviewer_name
      from overtime_requests o
      join profiles p on p.user_id = o.user_id
      left join profiles r on r.user_id = o.reviewed_by
      where o.company_id = ${profile.companyId}
        and (${canReview(profile.role)} or o.user_id = ${profile.userId})
      order by case when o.status = 'pending' then 0 else 1 end, o.created_at desc
      limit 80
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id,
      fullName: row.full_name,
      workDate: dateOnly(row.work_date),
      startTime: row.start_time,
      endTime: row.end_time,
      minutes: Number(row.minutes),
      note: row.note,
      status: row.status,
      reviewNote: row.review_note,
      createdAt: stamp(row.created_at),
      reviewedByName: row.reviewer_name,
      reviewedAt: row.reviewed_at ? stamp(row.reviewed_at) : null,
    }));
  });

export const reviewOvertimeRequest = createServerFn({ method: "POST" })
  .validator((input: { id: number; decision: "approved" | "rejected"; reviewNote: string }) => {
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Đơn không hợp lệ");
    if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Quyết định không hợp lệ");
    return { id, decision: input.decision, reviewNote: (input.reviewNote ?? "").trim().slice(0, 300) };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Bạn không có quyền duyệt");
    const sql = await getSql();
    const rows = await sql<{ user_id: string; work_date: unknown; status: string }>`
      select user_id, work_date, status from overtime_requests where id = ${data.id} and company_id = ${profile.companyId}
    `;
    const row = rows[0];
    if (!row || row.status !== "pending") throw new Error("Đơn không còn chờ duyệt");
    if (row.user_id === profile.userId) {
      const only = await isOnlyReviewer(profile.companyId, profile.userId);
      if (!only) throw new Error("Không tự duyệt đơn của mình");
    }
    if (data.decision === "approved") await assertMonthOpen(profile.companyId, dateOnly(row.work_date));
    await sql`
      update overtime_requests
      set status = ${data.decision}, reviewed_by = ${profile.userId}, reviewed_at = now(), review_note = ${data.reviewNote || null}
      where id = ${data.id} and status = 'pending'
    `;
    return { ok: true };
  });

export const listHolidays = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HolidayRow[]> => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<{ date: unknown; name: string }>`
      select date, name from holidays where company_id = ${profile.companyId} order by date desc limit 120
    `;
    return rows.map((r) => ({ date: dateOnly(r.date), name: r.name }));
  });

export const reviewLeave = createServerFn({ method: "POST" })
  .validator((input: { id: number; decision: "approved" | "rejected"; reviewNote: string }) => {
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Đơn không hợp lệ");
    if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Quyết định không hợp lệ");
    return { id, decision: input.decision, reviewNote: (input.reviewNote ?? "").trim().slice(0, 300) };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!canReview(profile.role)) throw new Error("Bạn không có quyền duyệt");
    const sql = await getSql();
    const rows = await sql<{ user_id: string; leave_date: unknown; status: string }>`
      select user_id, leave_date, status from leave_requests where id = ${data.id} and company_id = ${profile.companyId}
    `;
    const row = rows[0];
    if (!row || row.status !== "pending") throw new Error("Đơn không còn chờ duyệt");
    if (row.user_id === profile.userId) {
        const only = await isOnlyReviewer(profile.companyId, profile.userId);
        if (!only) throw new Error("Không tự duyệt đơn của mình");
      }
    if (data.decision === "approved") {
      await assertMonthOpen(profile.companyId, dateOnly(row.leave_date));
    }
    await sql`
      update leave_requests
      set status = ${data.decision}, reviewed_by = ${profile.userId}, reviewed_at = now(), review_note = ${data.reviewNote || null}
      where id = ${data.id} and status = 'pending'
    `;
    return { ok: true };
  });

export const saveHoliday = createServerFn({ method: "POST" })
  .validator((input: { date: string; name: string; remove?: boolean }) => {
    const date = input.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Ngày chưa đúng");
    const name = input.name.trim().slice(0, 80);
    if (!input.remove && name.length < 2) throw new Error("Đặt tên ngày lễ");
    return { date, name, remove: Boolean(input.remove) };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (profile.role !== "admin") throw new Error("Chỉ quản trị được sửa ngày lễ");
    const sql = await getSql();
    if (data.remove) {
      await sql`delete from holidays where company_id = ${profile.companyId} and date = ${data.date}::date`;
    } else {
      await sql`
        insert into holidays (company_id, date, name) values (${profile.companyId}, ${data.date}::date, ${data.name})
        on conflict (company_id, date) do update set name = excluded.name
      `;
    }
    return { ok: true };
  });
