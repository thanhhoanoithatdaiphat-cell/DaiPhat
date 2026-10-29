import type { Cell, Sheet, StyleSpec } from "@/lib/xlsx-lite";

const BRAND = "5A3B0A"; // nâu đậm của thương hiệu
const HEAD: StyleSpec = { bold: true, color: "FFFFFF", fill: BRAND, h: "center", wrap: true, border: true };
const BAND = "F8F1DE";

export function num(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function hmToMinutes(hm: string | undefined): number {
  const m = /^(\d+):(\d{2})$/.exec(hm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function viDate(key: string): string {
  const [y, m, d] = key.split("-");
  return y && m && d ? `${d}/${m}/${y}` : key;
}

function title(text: string, sub: string, cols: number): { rows: Cell[][]; merges: string[] } {
  const last = String.fromCharCode(64 + Math.min(cols, 26));
  return {
    rows: [
      [{ v: text, s: { bold: true, size: 16, color: BRAND, h: "left" } }],
      [{ v: sub, s: { italic: true, color: "6B6355", h: "left" } }],
      [],
    ],
    merges: [`A1:${last}1`, `A2:${last}2`],
  };
}

type TimesheetFile = { companyName: string; month: string; header: string[]; rows: string[][] };

/** Hai trang: Tổng hợp theo nhân viên (xem trước) và Chi tiết từng ngày, có kẻ bảng, tô màu, lọc, cố định tiêu đề. */
export function timesheetSheets(file: TimesheetFile): Sheet[] {
  const [y, m] = file.month.split("-");
  const monthText = `tháng ${Number(m)}/${y}`;
  const stamp = new Date().toLocaleDateString("vi-VN");
  const sub = `${file.companyName} · Xuất ngày ${stamp}`;

  // ----- Chi tiết -----
  const cols = [
    { h: "Họ tên", w: 24, kind: "text" },
    { h: "Mã NV", w: 10, kind: "center" },
    { h: "Phòng ban", w: 16, kind: "text" },
    { h: "Chức danh", w: 16, kind: "text" },
    { h: "Số điện thoại", w: 14, kind: "center" },
    { h: "Ngày", w: 12, kind: "date" },
    { h: "Giờ vào", w: 9, kind: "center" },
    { h: "Giờ ra", w: 9, kind: "center" },
    { h: "Số giờ", w: 9, kind: "center" },
    { h: "Công", w: 8, kind: "num" },
    { h: "Loại ngày", w: 11, kind: "center" },
    { h: "Hệ số", w: 8, kind: "num" },
    { h: "Công quy đổi", w: 11, kind: "num" },
    { h: "Đi muộn (phút)", w: 10, kind: "num" },
    { h: "Tăng ca", w: 9, kind: "center" },
    { h: "Tăng ca được tính", w: 11, kind: "center" },
    { h: "Trạng thái tăng ca", w: 14, kind: "center" },
    { h: "Ra sớm", w: 8, kind: "center" },
    { h: "Ngoài điểm", w: 9, kind: "center" },
    { h: "Thiếu giờ ra", w: 9, kind: "center" },
  ] as const;
  const t = title(`BẢNG CHẤM CÔNG CHI TIẾT – ${monthText.toUpperCase()}`, sub, cols.length);
  const headerRow = t.rows.length + 1;
  const detail: Cell[][] = [...t.rows, cols.map((c) => ({ v: c.h, s: HEAD }))];
  let group = -1;
  let lastName = "";
  for (const r of file.rows) {
    if (r[0] !== lastName) {
      group++;
      lastName = r[0];
    }
    const fill = group % 2 === 1 ? BAND : undefined;
    detail.push(
      cols.map((c, i): Cell => {
        const raw = r[i] ?? "";
        const base: StyleSpec = { border: true, fill, h: c.kind === "text" ? "left" : "center" };
        if (c.kind === "date") return { v: viDate(raw), s: base };
        if (c.kind === "num") {
          const n = num(raw);
          return { v: n, s: { ...base, fmt: i === 11 || i === 12 || i === 9 ? "0.0#" : "0" } };
        }
        if (i === 10 && raw !== "Thường") return { v: raw, s: { ...base, bold: true, color: raw === "Lễ" ? "B42318" : "9A6700" } };
        if ((i === 17 || i === 19) && raw === "Có") return { v: raw, s: { ...base, bold: true, color: "B42318" } };
        if (i === 18 && raw === "Có") return { v: raw, s: { ...base, bold: true, color: "9A6700" } };
        if ((i === 17 || i === 18 || i === 19) && raw === "Không") return { v: raw, s: { ...base, color: "A39B8A" } };
        if (i === 13 && num(raw)) return { v: num(raw), s: { ...base, fmt: "0", bold: true, color: "B42318" } };
        return { v: raw, s: base };
      }),
    );
  }
  const detailSheet: Sheet = {
    name: "Chi tiết",
    rows: detail,
    widths: cols.map((c) => c.w),
    freeze: { rows: headerRow, cols: 1 },
    merges: t.merges,
    headerRow,
    rowHeights: { 1: 26, [headerRow]: 34 },
  };

  // ----- Tổng hợp -----
  type Agg = { name: string; code: string; dept: string; title: string; days: number; cong: number; quyDoi: number; lateDays: number; lateMin: number; otMin: number; missOut: number; offsite: number };
  const byName = new Map<string, Agg>();
  for (const r of file.rows) {
    const a =
      byName.get(r[0]) ??
      ({ name: r[0], code: r[1], dept: r[2], title: r[3], days: 0, cong: 0, quyDoi: 0, lateDays: 0, lateMin: 0, otMin: 0, missOut: 0, offsite: 0 } as Agg);
    if (r[6]) a.days++;
    a.cong += num(r[9]) ?? 0;
    a.quyDoi += num(r[12]) ?? 0;
    const late = num(r[13]) ?? 0;
    if (late > 0) {
      a.lateDays++;
      a.lateMin += late;
    }
    a.otMin += hmToMinutes(r[15]);
    if (r[19] === "Có") a.missOut++;
    if (r[18] === "Có") a.offsite++;
    byName.set(r[0], a);
  }
  const list = [...byName.values()];
  const sc = [
    { h: "STT", w: 6 },
    { h: "Họ tên", w: 26 },
    { h: "Mã NV", w: 10 },
    { h: "Phòng ban", w: 18 },
    { h: "Chức danh", w: 18 },
    { h: "Số ngày có mặt", w: 12 },
    { h: "Tổng công", w: 11 },
    { h: "Công quy đổi", w: 12 },
    { h: "Số lần đi muộn", w: 11 },
    { h: "Tổng phút muộn", w: 11 },
    { h: "Tăng ca được tính (giờ)", w: 14 },
    { h: "Ngày thiếu giờ ra", w: 11 },
    { h: "Ngày chấm ngoài điểm", w: 12 },
  ];
  const t2 = title(`BẢNG CHẤM CÔNG TỔNG HỢP – ${monthText.toUpperCase()}`, sub, sc.length);
  const h2 = t2.rows.length + 1;
  const sum: Cell[][] = [...t2.rows, sc.map((c) => ({ v: c.h, s: HEAD }))];
  list.forEach((a, i) => {
    const fill = i % 2 === 1 ? BAND : undefined;
    const b: StyleSpec = { border: true, fill, h: "center" };
    const round = (n: number) => Math.round(n * 100) / 100;
    sum.push([
      { v: i + 1, s: b },
      { v: a.name, s: { ...b, h: "left", bold: true } },
      { v: a.code, s: b },
      { v: a.dept, s: { ...b, h: "left" } },
      { v: a.title, s: { ...b, h: "left" } },
      { v: a.days, s: { ...b, fmt: "0" } },
      { v: round(a.cong), s: { ...b, fmt: "0.0#" } },
      { v: round(a.quyDoi), s: { ...b, fmt: "0.0#", bold: true } },
      { v: a.lateDays, s: { ...b, fmt: "0", ...(a.lateDays ? { color: "B42318", bold: true } : {}) } },
      { v: a.lateMin, s: { ...b, fmt: "0" } },
      { v: Math.round((a.otMin / 60) * 100) / 100, s: { ...b, fmt: "0.0#" } },
      { v: a.missOut, s: { ...b, fmt: "0", ...(a.missOut ? { color: "B42318", bold: true } : {}) } },
      { v: a.offsite, s: { ...b, fmt: "0" } },
    ]);
  });
  if (list.length) {
    const first = h2 + 1;
    const last = h2 + list.length;
    const tot: StyleSpec = { border: true, bold: true, fill: "EADFC0", h: "center" };
    const col = (c: string, field: (a: Agg) => number, dec: boolean): Cell => ({
      f: `SUM(${c}${first}:${c}${last})`,
      v: Math.round(list.reduce((n, a) => n + field(a), 0) * 100) / 100,
      s: { ...tot, fmt: dec ? "0.0#" : "0" },
    });
    sum.push([
      { v: "", s: tot },
      { v: "TỔNG CỘNG", s: { ...tot, h: "left" } },
      { v: "", s: tot },
      { v: "", s: tot },
      { v: "", s: tot },
      col("F", (a) => a.days, false),
      col("G", (a) => a.cong, true),
      col("H", (a) => a.quyDoi, true),
      col("I", (a) => a.lateDays, false),
      col("J", (a) => a.lateMin, false),
      col("K", (a) => a.otMin / 60, true),
      col("L", (a) => a.missOut, false),
      col("M", (a) => a.offsite, false),
    ]);
  }
  const summarySheet: Sheet = {
    name: "Tổng hợp",
    rows: sum,
    widths: sc.map((c) => c.w),
    freeze: { rows: h2, cols: 2 },
    merges: t2.merges,
    headerRow: h2,
    rowHeights: { 1: 26, [h2]: 36 },
  };
  return [summarySheet, detailSheet];
}

/** Bảng đơn giản có kẻ bảng: tiêu đề, dòng mô tả, dòng tiêu cột và dữ liệu. */
export function tableSheet(opts: { name: string; title: string; subtitle: string; header: string[]; rows: string[][]; widths?: number[]; numeric?: number[] }): Sheet {
  const t = title(opts.title, opts.subtitle, opts.header.length);
  const headerRow = t.rows.length + 1;
  const widths =
    opts.widths ??
    opts.header.map((h, i) => {
      const longest = Math.max(h.length, ...opts.rows.slice(0, 200).map((r) => (r[i] ?? "").length));
      return Math.min(40, Math.max(8, Math.round(longest * 1.15) + 2));
    });
  const body: Cell[][] = opts.rows.map((r, ri) =>
    opts.header.map((_, i): Cell => {
      const raw = r[i] ?? "";
      const base: StyleSpec = { border: true, fill: ri % 2 === 1 ? BAND : undefined, h: opts.numeric?.includes(i) ? "center" : "left", wrap: raw.length > 40 };
      if (opts.numeric?.includes(i)) return { v: num(raw) ?? raw, s: base };
      return { v: raw, s: base };
    }),
  );
  return {
    name: opts.name,
    rows: [...t.rows, opts.header.map((h) => ({ v: h, s: HEAD })), ...body],
    widths,
    freeze: { rows: headerRow },
    merges: t.merges,
    headerRow,
    rowHeights: { 1: 26, [headerRow]: 34 },
  };
}
