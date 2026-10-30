import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCell, countableOvertime, monthDayKeys, summarize, weekdayOf, workedMinutes } from "../src/lib/month-grid.ts";

const hm = (iso) => iso.slice(11, 16);
const p = (type, at, extra = {}) => ({
  id: 1, type, at, status: "valid", offsite: false, lateMinutes: 0, overtimeMinutes: 0,
  overtimeStatus: "none", nearestName: null, distanceMeters: null, hasPhoto: false, ...extra,
});
const cell = (dateKey, punches, extra = {}) =>
  buildCell({ dateKey, punches, todayKey: "2026-10-14", startedOn: null, lateThreshold: 5, hm, ...extra });

test("monthDayKeys và weekdayOf", () => {
  assert.equal(monthDayKeys("2026-02").length, 28);
  assert.equal(monthDayKeys("2026-10").at(-1), "2026-10-31");
  assert.equal(weekdayOf("2026-10-11"), 0);
});

test("ngày không chấm: Chủ nhật nghỉ, quá khứ vắng, tương lai trống, trước ngày vào làm nghỉ", () => {
  assert.equal(cell("2026-10-11", []).kind, "off");
  assert.equal(cell("2026-10-12", []).kind, "absent");
  assert.equal(cell("2026-10-15", []).kind, "future");
  assert.equal(cell("2026-10-14", []).kind, "future");
  assert.equal(cell("2026-10-05", [], { startedOn: "2026-10-10" }).kind, "off");
});

test("đủ vào/ra là ok, đi muộn là late, thiếu giờ ra là partial", () => {
  const ok = cell("2026-10-12", [p("in", "2026-10-12T01:00:00Z"), p("out", "2026-10-12T10:00:00Z")]);
  assert.equal(ok.kind, "ok");
  const late = cell("2026-10-12", [p("in", "2026-10-12T01:20:00Z", { lateMinutes: 20 }), p("out", "2026-10-12T10:00:00Z")]);
  assert.equal(late.kind, "late");
  assert.equal(cell("2026-10-12", [p("in", "2026-10-12T01:00:00Z")]).kind, "partial");
  assert.equal(cell("2026-10-14", [p("in", "2026-10-14T01:00:00Z")]).kind, "ok");
});

test("đi muộn trong thời gian châm chước (dưới ngưỡng) vẫn là ok", () => {
  const within = cell("2026-10-12", [p("in", "2026-10-12T01:03:00Z", { lateMinutes: 3 }), p("out", "2026-10-12T10:00:00Z")]);
  assert.equal(within.kind, "ok");
  const edge = cell("2026-10-12", [p("in", "2026-10-12T01:05:00Z", { lateMinutes: 5 }), p("out", "2026-10-12T10:00:00Z")]);
  assert.equal(edge.kind, "late");
});

test("summarize chỉ tính tăng ca đã duyệt", () => {
  const a = cell("2026-10-12", [p("in", "2026-10-12T01:00:00Z"), p("out", "2026-10-12T12:00:00Z", { overtimeMinutes: 90, overtimeStatus: "approved" })]);
  const b = cell("2026-10-13", [p("in", "2026-10-13T01:00:00Z"), p("out", "2026-10-13T12:00:00Z", { overtimeMinutes: 60, overtimeStatus: "pending" })]);
  const s = summarize([a, b, cell("2026-10-09", [])]);
  assert.deepEqual(s, {
    days: 2, cong: 2, sundayCong: 0, holidayCong: 0, congQuyDoi: 2, premiumPending: 0,
    leave: 0, holiday: 0, late: 0, absent: 1, partial: 0, overtimeMinutes: 90,
  });
});

test("công: đủ giờ = 1, nửa ngày = 0.5, quá ít = 0, đang làm hôm nay chưa tính", () => {
  const day = "2026-10-12";
  const mk = (inH, outH) => cell(day, [p("in", `${day}T0${inH}:00:00Z`), p("out", `${day}T${String(outH).padStart(2, "0")}:00:00Z`)]);
  assert.equal(mk(1, 9).cong, 1); // 8 giờ
  assert.equal(mk(1, 6).cong, 0.5); // 5 giờ
  assert.equal(mk(1, 3).cong, 0); // 2 giờ
  assert.equal(mk(1, 9).workedMinutes, 480);
  const live = cell("2026-10-14", [p("in", "2026-10-14T01:00:00Z")]);
  assert.equal(live.kind, "ok");
  assert.equal(live.cong, null);
});

test("công: thiếu giờ ra ở quá khứ là 0; vắng là 0; nghỉ phép không có công; nghỉ lễ không tính công", () => {
  assert.equal(cell("2026-10-12", [p("in", "2026-10-12T01:00:00Z")]).cong, 0);
  assert.equal(cell("2026-10-12", []).cong, 0);
  assert.equal(cell("2026-10-12", [], { isHoliday: true }).cong, 0);
  assert.equal(cell("2026-10-12", [], { hasApprovedLeave: true, leaveKind: "om" }).label, "Ố");
});

test("công: ngưỡng tùy chỉnh và tổng hợp theo tháng", () => {
  const day = "2026-10-12";
  const c = cell(day, [p("in", `${day}T01:00:00Z`), p("out", `${day}T05:00:00Z`)], { fullDayMinutes: 360, halfDayMinutes: 180 });
  assert.equal(c.cong, 0.5); // 4 giờ < 6 giờ
  const full = cell("2026-10-13", [p("in", "2026-10-13T01:00:00Z"), p("out", "2026-10-13T09:00:00Z")]);
  const holiday = cell("2026-10-14", [], { isHoliday: true, todayKey: "2026-10-30" });
  const leave = cell("2026-10-15", [], { hasApprovedLeave: true, todayKey: "2026-10-30" });
  const s = summarize([c, full, holiday, leave]);
  assert.equal(s.cong, 1.5); // 0.5 + 1; nghỉ lễ không tính công
  assert.equal(s.holiday, 1);
  assert.equal(s.leave, 1);
});

test("Chủ nhật và lễ chỉ tính khi tăng ca đã duyệt, nhân hệ số", () => {
  const sun = (status) =>
    cell("2026-10-11", [p("in", "2026-10-11T01:00:00Z"), p("out", "2026-10-11T09:00:00Z", { overtimeMinutes: 480, overtimeStatus: status })], { todayKey: "2026-10-30" });
  assert.equal(sun("approved").dayType, "sunday");
  const ok = summarize([sun("approved")], { sunday: 1.5, holiday: 2 });
  assert.equal(ok.sundayCong, 1);
  assert.equal(ok.congQuyDoi, 1.5);
  const pend = summarize([sun("pending")], { sunday: 1.5, holiday: 2 });
  assert.equal(pend.congQuyDoi, 0);
  assert.equal(pend.premiumPending, 1);
  const hol = cell("2026-10-14", [p("in", "2026-10-14T01:00:00Z"), p("out", "2026-10-14T09:00:00Z", { overtimeMinutes: 480, overtimeStatus: "approved" })], { isHoliday: true, todayKey: "2026-10-30" });
  assert.equal(summarize([hol], { sunday: 1.5, holiday: 2 }).congQuyDoi, 2);
});

test("workedMinutes cộng từng đoạn vào–ra, bỏ nghỉ trưa", () => {
  const d = "2026-10-12";
  const mins = workedMinutes([
    p("in", `${d}T01:00:00Z`), p("out", `${d}T05:00:00Z`),
    p("in", `${d}T06:00:00Z`), p("out", `${d}T10:00:00Z`),
  ]);
  assert.equal(mins, 480);
});

test("giờ làm trừ nghỉ trưa, vào sớm/ra muộn không cộng thêm trong ngày thường", () => {
  const sc = { start: "07:30", end: "17:30", lunchStart: "11:30", lunchEnd: "13:30" };
  const d = "2026-10-12"; // giờ VN = UTC + 7
  const at = (hm) => { const [h, m] = hm.split(":").map(Number); return new Date(Date.UTC(2026, 9, 12, h - 7, m)).toISOString(); };
  const pair = (a, b) => [p("in", at(a)), p("out", at(b))];
  assert.equal(workedMinutes(pair("07:30", "17:30"), { schedule: sc, clip: true }), 480);
  assert.equal(workedMinutes(pair("07:00", "18:15"), { schedule: sc, clip: true }), 480); // vào sớm, ra muộn: tăng ca tính riêng
  assert.equal(workedMinutes(pair("07:50", "17:30"), { schedule: sc, clip: true }), 460);
  assert.equal(workedMinutes(pair("07:30", "11:30"), { schedule: sc, clip: true }), 240); // chỉ làm buổi sáng
  assert.equal(workedMinutes(pair("07:00", "18:00"), { schedule: sc, clip: false }), 540); // Chủ nhật/lễ: cả buổi trừ nghỉ trưa
  assert.equal(workedMinutes(pair("07:30", "17:30")), 600); // không có lịch: cộng thẳng như cũ
  const c = cell(d, pair("07:30", "17:30"), { schedule: sc });
  assert.equal(c.workedMinutes, 480);
  assert.equal(c.cong, 1);
});

test("đơn tăng ca: chỉ tính giờ nghỉ trưa", () => {
  const sc = { start: "07:30", end: "17:30", lunchStart: "11:30", lunchEnd: "13:30" };
  assert.equal(countableOvertime("11:30", "13:30", sc), 120); // cả buổi trưa
  assert.equal(countableOvertime("12:00", "13:00", sc), 60);
  assert.equal(countableOvertime("11:00", "14:00", sc), 120); // phần trong ca không tính
  assert.equal(countableOvertime("06:30", "07:30", sc), 0); // trước giờ vào ca: không tính
  assert.equal(countableOvertime("17:30", "20:00", sc), 0); // sau giờ ra: tự tính khi chấm ra
  assert.equal(countableOvertime("13:30", "12:00", sc), 0);
});

test("tăng ca theo đơn đã duyệt cộng vào tổng tăng ca của tháng", () => {
  const d = "2026-10-12";
  const c = cell(d, [p("in", `${d}T01:00:00Z`), p("out", `${d}T10:00:00Z`)], { extraOvertimeMinutes: 90 });
  assert.equal(c.extraOvertimeMinutes, 90);
  assert.equal(summarize([c]).overtimeMinutes, 90);
});

test("giờ tăng ca theo đơn không mất khi ngày đó không có lượt chấm", () => {
  const c = cell("2026-10-12", [], { extraOvertimeMinutes: 120 });
  assert.equal(summarize([c]).overtimeMinutes, 120);
});
