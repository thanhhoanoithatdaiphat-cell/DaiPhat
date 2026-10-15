import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCell, monthDayKeys, summarize, weekdayOf } from "../src/lib/month-grid.ts";

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
  assert.deepEqual(s, { days: 2, late: 0, absent: 1, partial: 0, overtimeMinutes: 90 });
});
