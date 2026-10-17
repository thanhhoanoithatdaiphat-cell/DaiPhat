import type { MonthPunch } from "./month-grid";

export type OvertimeStatus = "none" | "pending" | "approved" | "rejected";

export type Role = "employee" | "approver" | "admin";

export type Settings = {
  workStart: string;
  workEnd: string;
  lateMinutes: number;
  maxCorrections: number;
  rankingsEnabled: boolean;
  requirePhoto: boolean;
  allowOffsite: boolean;
};

export type LocationRow = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  isActive: boolean;
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

export type PersonRow = {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  lastType: "in" | "out" | null;
  lastAt: string | null;
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
    }
  | {
      ok: false;
      nearestName: string;
      distanceMeters: number;
      message: string;
    };

export type RankLists = {
  enabled: boolean;
  consistent: { fullName: string; days: number; onTime: number; rate: number }[];
  earliest: { fullName: string; avgMinutes: number; days: number }[];
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

export type MonthGrid = {
  month: string;
  todayKey: string;
  people: MonthPerson[];
  /** userId -> yyyy-mm-dd -> các lần chấm trong ngày */
  punches: Record<string, Record<string, MonthPunch[]>>;
  holidays?: string[];
  leaves?: Record<string, Record<string, string>>;
  lock: { lockedAt: string; lockedByName: string } | null;
};
