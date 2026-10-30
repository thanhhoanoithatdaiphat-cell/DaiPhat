import type { MonthPunch, Schedule } from "./month-grid";

export type OvertimeStatus = "none" | "pending" | "approved" | "rejected";

export type Role = "employee" | "approver" | "admin";

export type Settings = {
  workStart: string;
  workEnd: string;
  /** Giờ nghỉ trưa (không tính vào giờ làm). */
  lunchStart: string;
  lunchEnd: string;
  /** Ra muộn từ số phút này trở lên thì mới tính tăng ca. */
  overtimeMinMinutes: number;
  lateMinutes: number;
  /** Làm từ số phút này thì tính 1 công. */
  fullDayMinutes: number;
  /** Làm từ số phút này thì tính 0.5 công. */
  halfDayMinutes: number;
  maxCorrections: number;
  /** Số ngày công chuẩn của một tháng (mặc định 26). */
  standardDays: number;
  /** Hệ số công khi làm Chủ nhật (đã được duyệt tăng ca). */
  sundayRate: number;
  /** Hệ số công khi làm ngày lễ (đã được duyệt tăng ca). */
  holidayRate: number;
  rankingsEnabled: boolean;
  requirePhoto: boolean;
  allowOffsite: boolean;
  /** Mỗi tài khoản (trừ quản trị) chỉ dùng được trên một máy. */
  deviceLock: boolean;
};

export type LocationRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  isActive: boolean;
};

/** Một người đã chấm công vào ca hôm nay (dùng cho danh sách "ai đã chấm công" của mọi nhân viên). */
export type TodayCheckin = {
  userId: string;
  fullName: string;
  department: string | null;
  avatar: string | null;
  firstInAt: string;
  lateMinutes: number;
  offsite: boolean;
  /** Lượt chấm cuối cùng hôm nay: "out" nghĩa là đã ra ca. */
  lastType: "in" | "out";
};

export type TodayCheckins = {
  /** Số người đã vào ca hôm nay. */
  punched: number;
  /** Số nhân viên đang làm việc của công ty. */
  total: number;
  people: TodayCheckin[];
};

export type PunchRow = {
  id: number;
  type: "in" | "out";
  punchedAt: string;
  status: "valid" | "corrected";
  nearestName: string | null;
  distanceMeters: number | null;
  locationSource: "gps" | "manual";
  hasPhoto: boolean;
  offsite: boolean;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: OvertimeStatus;
  userId?: string;
  fullName?: string;
  /** Toạ độ và địa chỉ nơi chấm (chỉ có với lượt chấm ngoài điểm). */
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
};

export type CorrectionRow = {
  id: number;
  userId: string;
  fullName: string;
  attendanceDate: string;
  punchType: "in" | "out";
  requestedTime: string;
  kind: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type LeaveKind = "phep" | "om" | "thaisan" | "khac";

export type LeaveRow = {
  id: number;
  userId: string;
  fullName: string;
  leaveDate: string;
  kind: LeaveKind;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type OvertimeRequestRow = {
  id: number;
  userId: string;
  fullName: string;
  workDate: string;
  startTime: string;
  endTime: string;
  /** Số phút được tính (chỉ phần nằm trong giờ nghỉ trưa). */
  minutes: number;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type HolidayRow = { date: string; name: string };

export type PersonRow = {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  lastType: "in" | "out" | null;
  lastAt: string | null;
  /** Giờ vào đầu tiên trong ngày hôm nay (null nếu chưa vào). */
  firstInAt?: string | null;
  /** Số phút đi muộn của lần vào đầu tiên hôm nay. */
  firstInLate?: number;
  employeeCode?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  startedOn?: string | null;
  endedOn?: string | null;
  isActive?: boolean;
  /** Máy đang được gắn với tài khoản (chỉ quản trị nhận được). */
  deviceLabel?: string | null;
  deviceBoundAt?: string | null;
  deviceBlockedCount?: number;
  deviceLastBlockedAt?: string | null;
  deviceLastBlockedLabel?: string | null;
};

export type ProfileRow = {
  userId: string;
  fullName: string;
  role: Role;
  phone: string | null;
  email: string | null;
  companyId: string;
  employeeCode: string | null;
  department: string | null;
  jobTitle: string | null;
  startedOn: string | null;
  avatar: string | null;
};

export type WorkspaceData = {
  profile: ProfileRow;
  companyName: string;
  settings: Settings;
  locations: LocationRow[];
  today: PunchRow[];
  teamToday: PersonRow[];
  pendingCount: number;
  offsiteToday: PunchRow[];
  lateToday: PunchRow[];
  overtimePending: PunchRow[];
};

/** Công tích lũy của chính người dùng trong tháng, hiện ở thẻ "Công tháng" trên điện thoại. */
export type MySummary = {
  month: string;
  /** Tổng công đã tính (ngày đang làm dở chưa tính). */
  cong: number;
  /** Số ngày công chuẩn của tháng (trừ Chủ nhật và ngày lễ). */
  standardDays: number;
};

export type PunchResult =
  | {
      ok: true;
      nearestName: string;
      distanceMeters: number;
      punchedAt: string;
      offsite: boolean;
      lateMinutes: number;
      overtimeMinutes: number;
      overtimeStatus: OvertimeStatus;
      lat: number;
      lng: number;
      /** Địa chỉ nơi chấm, chỉ tra khi chấm ngoài điểm (có thể null nếu không tra được). */
      address: string | null;
    }
  | {
      ok: false;
      nearestName: string;
      distanceMeters: number;
      message: string;
      address: string | null;
    };

export type RankLists = {
  enabled: boolean;
  consistent: { userId: string; fullName: string; avatar: string | null; days: number; onTime: number; rate: number }[];
  earliest: { userId: string; fullName: string; avatar: string | null; avgMinutes: number; days: number }[];
};

export type MonthPerson = {
  userId: string;
  fullName: string;
  employeeCode: string | null;
  department: string | null;
  role: Role;
  startedOn: string | null;
  endedOn?: string | null;
  isActive?: boolean;
};

/** Dữ liệu chấm công của một khoảng ngày bất kỳ (tối đa HISTORY_MAX_DAYS ngày). */
export type HistoryData = {
  from: string;
  to: string;
  todayKey: string;
  people: MonthPerson[];
  /** userId -> yyyy-mm-dd -> các lần chấm trong ngày */
  punches: Record<string, Record<string, MonthPunch[]>>;
  holidays: string[];
  leaves: Record<string, Record<string, string>>;
  /** userId -> yyyy-mm-dd -> phút tăng ca theo đơn đã duyệt. */
  extraOt?: Record<string, Record<string, number>>;
  /** Các tháng trong khoảng đã chốt công. */
  lockedMonths: string[];
  /** true khi số lượt chấm vượt giới hạn và danh sách bị cắt bớt. */
  truncated: boolean;
};

export const HISTORY_MAX_DAYS = 93;

export type AuditEvent = {
  key: string;
  kind: "correction" | "leave" | "overtime";
  status: "pending" | "approved" | "rejected";
  userId: string;
  fullName: string;
  /** Ngày công mà sự kiện áp dụng (yyyy-mm-dd). */
  date: string;
  /** Mô tả ngắn: loại đơn, giờ xin sửa, số phút tăng ca… */
  subject: string;
  note: string;
  reviewNote: string | null;
  createdAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type MonthGrid = {
  month: string;
  todayKey: string;
  people: MonthPerson[];
  /** userId -> yyyy-mm-dd -> các lần chấm trong ngày */
  punches: Record<string, Record<string, MonthPunch[]>>;
  holidays?: string[];
  leaves?: Record<string, Record<string, string>>;
  /** userId -> yyyy-mm-dd -> phút tăng ca theo đơn đã duyệt. */
  extraOt?: Record<string, Record<string, number>>;
  lock: { lockedAt: string; lockedByName: string } | null;
};

export function scheduleOf(s: Settings): Schedule {
  return { start: s.workStart, end: s.workEnd, lunchStart: s.lunchStart, lunchEnd: s.lunchEnd };
}
