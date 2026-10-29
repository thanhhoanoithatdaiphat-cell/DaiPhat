/**
 * Trình tạo file Excel (.xlsx) gọn, không cần thư viện ngoài: có kẻ bảng, tô màu tiêu đề, độ rộng cột,
 * cố định dòng tiêu đề, bộ lọc, gộp ô, công thức và định dạng in. File .xlsx là một gói zip các tệp XML;
 * ở đây ghi zip kiểu "store" (không nén) nên đủ cho Excel, LibreOffice và Google Sheets.
 */

export type StyleSpec = {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  /** Màu chữ dạng RRGGBB */
  color?: string;
  /** Màu nền dạng RRGGBB */
  fill?: string;
  h?: "left" | "center" | "right";
  v?: "top" | "center";
  wrap?: boolean;
  /** Kẻ viền mảnh quanh ô */
  border?: boolean;
  /** Định dạng số, ví dụ "0.0" hoặc "#,##0" */
  fmt?: string;
};

export type Cell = string | number | null | undefined | { v?: string | number | null; s?: StyleSpec; f?: string };

export type Sheet = {
  name: string;
  rows: Cell[][];
  widths: number[];
  /** Cố định các dòng đầu (và cột đầu) khi cuộn */
  freeze?: { rows: number; cols?: number };
  /** Vùng gộp ô, ví dụ "A1:H1" */
  merges?: string[];
  /** Dòng tiêu đề (đếm từ 1) để bật bộ lọc và lặp lại khi in */
  headerRow?: number;
  landscape?: boolean;
  rowHeights?: Record<number, number>;
};

const enc = new TextEncoder();

function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

class StyleBook {
  fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  fmts: string[] = [];
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private cache = new Map<string, number>();

  private idx(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  get(spec?: StyleSpec): number {
    if (!spec) return 0;
    const key = JSON.stringify(spec);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const font = this.idx(
      this.fonts,
      `<font>${spec.bold ? "<b/>" : ""}${spec.italic ? "<i/>" : ""}<sz val="${spec.size ?? 11}"/>${spec.color ? `<color rgb="FF${spec.color}"/>` : ""}<name val="Calibri"/></font>`,
    );
    const fill = spec.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${spec.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (n: string) => `<${n} style="thin"><color rgb="FFBFB6A3"/></${n}>`;
    const border = spec.border ? this.idx(this.borders, `<border>${side("left")}${side("right")}${side("top")}${side("bottom")}<diagonal/></border>`) : 0;
    let fmtId = 0;
    if (spec.fmt) {
      let i = this.fmts.indexOf(spec.fmt);
      if (i < 0) {
        this.fmts.push(spec.fmt);
        i = this.fmts.length - 1;
      }
      fmtId = 164 + i;
    }
    const align = `<alignment horizontal="${spec.h ?? "general"}" vertical="${spec.v ?? "center"}"${spec.wrap ? ' wrapText="1"' : ""}/>`;
    const xf = `<xf numFmtId="${fmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${fmtId ? ' applyNumberFormat="1"' : ""}>${align}</xf>`;
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }

  xml(): string {
    const numFmts = this.fmts.length ? `<numFmts count="${this.fmts.length}">${this.fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>` : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      numFmts +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

function sheetXml(sheet: Sheet, book: StyleBook, index: number): string {
  const lastCol = Math.max(sheet.widths.length, ...sheet.rows.map((r) => r.length)) - 1;
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rowsXml = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((raw, c) => {
          if (raw == null) return "";
          const cell = typeof raw === "object" ? raw : { v: raw };
          const ref = `${colName(c)}${r + 1}`;
          const s = book.get(cell.s);
          const sAttr = s ? ` s="${s}"` : "";
          if (cell.f) return `<c r="${ref}"${sAttr}><f>${esc(cell.f)}</f>${typeof cell.v === "number" ? `<v>${cell.v}</v>` : ""}</c>`;
          if (cell.v == null || cell.v === "") return s ? `<c r="${ref}"${sAttr}/>` : "";
          if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
          return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`;
        })
        .join("");
      const h = sheet.rowHeights?.[r + 1];
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");
  const fr = sheet.freeze;
  const pane = fr
    ? `<sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""} showGridLines="0"><pane ${fr.cols ? `xSplit="${fr.cols}" ` : ""}ySplit="${fr.rows}" topLeftCell="${colName(fr.cols ?? 0)}${fr.rows + 1}" activePane="${fr.cols ? "bottomRight" : "bottomLeft"}" state="frozen"/></sheetView>`
    : `<sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""} showGridLines="0"/>`;
  const filter = sheet.headerRow ? `<autoFilter ref="A${sheet.headerRow}:${colName(lastCol)}${sheet.rows.length}"/>` : "";
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>${pane}</sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rowsXml}</sheetData>` +
    filter +
    merges +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape === false ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/></worksheet>`
  );
}

// ---- zip (không nén) ----
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name]);
    parts.push(local, f.data);
    central.push(
      Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]),
    );
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  base = n;
  return base;
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const book = new StyleBook();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, book, i)) }));
  const defined = sheets
    .map((s, i) => (s.headerRow ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${names[i].replace(/'/g, "''")}'!$${s.headerRow}:$${s.headerRow}</definedName>` : ""))
    .join("");
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    ...sheetFiles,
  ];
  // styles.xml phải ghi sau khi mọi sheet đã đăng ký kiểu
  files.splice(4, 0, { name: "xl/styles.xml", data: enc.encode(book.xml()) });
  return zip(files);
}

export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const bytes = buildXlsx(sheets);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}
