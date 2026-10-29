import { useMemo, useState, type FormEvent } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { downloadCsv as downloadCsvFile } from "@/lib/download";
import { errorText, fieldClass, primaryBtn, secondaryBtn } from "@/components/ui";
import { adminCreateEmployees, type NewEmployeeInput, type NewEmployeeResult } from "@/lib/attendance.functions";
import { displayPhone, normalizeVnPhone, phoneFromLoginEmail } from "@/lib/phone";
import type { PersonRow } from "@/lib/attendance-types";

type Row = NewEmployeeInput & { error?: string };

/** Mã NV kế tiếp theo mẫu mã đang dùng (NV007 → NV008, 12 → 13). */
export function nextCodes(existing: (string | null | undefined)[], count: number): string[] {
  let best: { prefix: string; n: number; width: number } | null = null;
  for (const c of existing) {
    const m = /^(\D*)(\d+)$/.exec((c ?? "").trim());
    if (!m) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix: m[1], n, width: m[2].length };
  }
  if (!best) return Array.from({ length: count }, () => "");
  const b = best;
  return Array.from({ length: count }, (_, i) => `${b.prefix}${String(b.n + i + 1).padStart(b.width, "0")}`);
}

function existingPhones(people: PersonRow[]): Set<string> {
  const set = new Set<string>();
  for (const p of people) {
    const raw = p.phone || phoneFromLoginEmail(p.email) || "";
    const n = normalizeVnPhone(raw);
    if (n) set.add(n);
  }
  return set;
}

/** Dán từ Excel/Zalo: mỗi dòng một người, cột cách nhau bằng Tab, dấu phẩy, chấm phẩy hoặc dấu |. */
export function parseBulk(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(/\t|;|\||,/).map((c) => c.trim());
      // Cho phép viết SĐT trước tên: nhận ra cột nào là số điện thoại.
      let phoneIdx = cols.findIndex((c, i) => i > 0 && normalizeVnPhone(c));
      if (phoneIdx < 0 && normalizeVnPhone(cols[0] ?? "")) phoneIdx = 0;
      if (phoneIdx < 0) return { fullName: cols[0] ?? "", phone: cols[1] ?? "", employeeCode: cols[2], department: cols[3], jobTitle: cols[4] };
      const phone = cols[phoneIdx];
      const rest = cols.filter((_, i) => i !== phoneIdx);
      return { fullName: rest[0] ?? "", phone, employeeCode: rest[1], department: rest[2], jobTitle: rest[3] };
    });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function loginMessage(r: NewEmployeeResult, url: string): string {
  return `Chào ${r.fullName}, đây là tài khoản chấm công của bạn.\nMở: ${url}\nSố điện thoại: ${r.phone}\nMật khẩu: ${r.password}\nBạn chỉ cần nhập hai dòng trên rồi bấm Đăng nhập.`;
}

function printSlips(list: NewEmployeeResult[], url: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const cards = list
    .map(
      (r) => `<div class="c"><p class="n">${esc(r.fullName)}</p><p>Mở: <b>${esc(url)}</b></p><p>Số điện thoại</p><p class="v">${esc(r.phone)}</p><p>Mật khẩu</p><p class="v">${esc(r.password ?? "")}</p></div>`,
    )
    .join("");
  w.document.write(
    `<!doctype html><meta charset="utf-8"><title>Phiếu đăng nhập</title><style>body{font-family:system-ui,sans-serif;margin:16px}h1{font-size:18px}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}.c{border:2px dashed #555;border-radius:10px;padding:14px;break-inside:avoid}.n{font-size:20px;font-weight:700;margin:0 0 8px}p{margin:2px 0;font-size:14px}.v{font-size:30px;font-weight:800;letter-spacing:2px;margin:0 0 6px}</style><h1>Phiếu đăng nhập – Vào Ca chấm công</h1><div class="g">${cards}</div><script>setTimeout(()=>print(),300)</script>`,
  );
  w.document.close();
}

function downloadCsv(list: NewEmployeeResult[], url: string) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["Họ tên,Số điện thoại,Mật khẩu,Địa chỉ", ...list.map((r) => [q(r.fullName), q(`'${r.phone}`), q(r.password ?? ""), q(url)].join(","))];
  downloadCsvFile("tai-khoan-nhan-vien.csv", lines.join("\n"));
}

/** Kết quả: phiếu đăng nhập chỉ hiện một lần vì hệ thống không lưu mật khẩu dạng đọc được. */
export function LoginSlips({ results, onDone }: { results: NewEmployeeResult[]; onDone: () => void }) {
  const url = typeof window === "undefined" ? "" : window.location.origin;
  const [copied, setCopied] = useState("");
  const good = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      window.prompt("Sao chép nội dung này", text);
    }
  }

  return (
    <div className="space-y-3">
      {good.length ? (
        <>
          <div className="rounded-md bg-ok/15 px-3 py-2 text-sm font-semibold text-ok">Đã tạo {good.length} tài khoản. Hãy in hoặc gửi mật khẩu ngay: đóng màn hình này là không xem lại được (vẫn cấp lại mật khẩu mới được).</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${primaryBtn} inline-flex items-center gap-2`} onClick={() => printSlips(good, url)}>
              <Printer className="size-4" /> In phiếu
            </button>
            <button type="button" className={`${secondaryBtn} inline-flex items-center gap-2`} onClick={() => void copy("all", good.map((r) => loginMessage(r, url)).join("\n\n"))}>
              <Copy className="size-4" /> {copied === "all" ? "Đã chép" : "Chép tin nhắn Zalo"}
            </button>
            <button type="button" className={`${secondaryBtn} inline-flex items-center gap-2`} onClick={() => downloadCsv(good, url)}>
              <Download className="size-4" /> Tải CSV
            </button>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-edge bg-card">
            {good.map((r) => (
              <li key={r.phone} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.fullName}</p>
                  <p className="text-sm text-muted tabular-nums">{r.phone}</p>
                </div>
                <p className="font-display text-2xl font-bold tracking-widest tabular-nums" data-testid="new-password">{r.password}</p>
                <button type="button" className="text-sm text-ink underline" onClick={() => void copy(r.phone, loginMessage(r, url))}>
                  {copied === r.phone ? "Đã chép" : "Chép"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {bad.length ? (
        <div className="rounded-md border border-clay/40 bg-card px-3 py-2 text-sm">
          <p className="font-semibold text-clay">{bad.length} dòng chưa tạo được:</p>
          <ul className="mt-1 space-y-0.5">
            {bad.map((r, i) => (
              <li key={i}>
                {r.fullName || "(trống)"} {r.phone ? `· ${r.phone}` : ""} — {r.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button type="button" className={`${secondaryBtn} w-full`} onClick={onDone}>
        Xong
      </button>
    </div>
  );
}

/** Quản trị đăng ký sẵn cho nhân viên: một người, hoặc dán cả danh sách. Nhân viên chỉ việc đăng nhập. */
export function AddEmployees({ people, onChanged, onClose }: { people: PersonRow[]; onChanged: () => Promise<void>; onClose?: () => void }) {
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dept, setDept] = useState("");
  const [title, setTitle] = useState("");
  const suggested = useMemo(() => nextCodes(people.map((p) => p.employeeCode), 1)[0], [people]);
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<NewEmployeeResult[] | null>(null);

  const taken = useMemo(() => existingPhones(people), [people]);
  const bulk = useMemo(() => {
    const rows = parseBulk(text);
    const codes = nextCodes(people.map((p) => p.employeeCode), rows.length);
    const seen = new Set<string>();
    let autoIdx = 0;
    return rows.map((r) => {
      const n = normalizeVnPhone(r.phone);
      let err: string | undefined;
      if ((r.fullName ?? "").trim().length < 2) err = "Thiếu họ tên";
      else if (!n) err = "Số điện thoại chưa đúng";
      else if (taken.has(n)) err = "Số này đã có tài khoản";
      else if (seen.has(n)) err = "Số bị trùng trong danh sách";
      if (n) seen.add(n);
      const employeeCode = r.employeeCode || codes[autoIdx] || "";
      if (!r.employeeCode) autoIdx++;
      return { ...r, employeeCode, error: err } as Row;
    });
  }, [text, people, taken]);
  const okRows = bulk.filter((r) => !r.error);

  const oneN = normalizeVnPhone(phone);
  const oneErr = phone && !oneN ? "Số điện thoại chưa đúng" : oneN && taken.has(oneN) ? "Số này đã có tài khoản" : "";

  async function submit(rows: NewEmployeeInput[]) {
    setBusy(true);
    setError("");
    try {
      const r = await adminCreateEmployees({ data: { people: rows } });
      setResults(r);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function submitOne(e: FormEvent) {
    e.preventDefault();
    void submit([{ fullName: name, phone, employeeCode: code ?? suggested, department: dept, jobTitle: title }]);
  }

  if (results) return <LoginSlips results={results} onDone={() => (onClose ? onClose() : setResults(null))} />;

  return (
    <div className="space-y-3">
      <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="tablist">
        {(
          [
            ["one", "Một người"],
            ["bulk", "Nhiều người (dán danh sách)"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`h-10 flex-1 px-3 ${mode === k ? "bg-ink text-card" : "bg-card"}`}>
            {t}
          </button>
        ))}
      </div>

      {mode === "one" ? (
        <form onSubmit={submitOne} className="space-y-2">
          <label className="block text-sm">
            Họ tên
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Nguyễn Văn A" />
          </label>
          <label className="block text-sm">
            Số điện thoại (dùng để đăng nhập)
            <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="0901 234 567" />
            {oneErr ? <span className="text-xs text-clay">{oneErr}</span> : null}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              Mã NV
              <input className={fieldClass} value={code ?? suggested} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="block text-sm">
              Phòng ban
              <input className={fieldClass} value={dept} onChange={(e) => setDept(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">
            Chức danh
            <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <p className="text-xs text-muted">Hệ thống tự tạo mật khẩu 8 chữ số dễ nhập. Bạn in phiếu hoặc gửi Zalo cho nhân viên.</p>
          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <button type="submit" className={`${primaryBtn} w-full`} disabled={busy || !!oneErr}>
            {busy ? "Đang tạo…" : "Tạo tài khoản"}
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Dán từ Excel hoặc gõ mỗi dòng một người: <b>Họ tên, Số điện thoại, Mã NV, Phòng ban, Chức danh</b> (chỉ cần hai cột đầu). Mã NV bỏ trống thì tự đánh số tiếp.
          </p>
          <textarea
            className={`${fieldClass} min-h-32 font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Nguyễn Văn A, 0901234567\nTrần Thị B\t0912345678\t\tXưởng\tThợ mộc"}
            aria-label="Danh sách nhân viên"
          />
          {bulk.length ? (
            <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-edge bg-card text-sm">
              {bulk.map((r, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    <b>{r.fullName || "(trống)"}</b> <span className="text-muted tabular-nums">{normalizeVnPhone(r.phone) ? displayPhone(normalizeVnPhone(r.phone)!) : r.phone}</span>
                    <span className="block text-xs text-muted">{[r.employeeCode, r.department, r.jobTitle].filter(Boolean).join(" · ")}</span>
                  </span>
                  {r.error ? <span className="shrink-0 text-xs font-semibold text-clay">{r.error}</span> : <span className="shrink-0 text-xs font-semibold text-ok">Hợp lệ</span>}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <button type="button" className={`${primaryBtn} w-full`} disabled={busy || okRows.length === 0} onClick={() => void submit(okRows.map(({ error: _e, ...r }) => r))}>
            {busy ? "Đang tạo…" : okRows.length ? `Tạo ${okRows.length} tài khoản${bulk.length > okRows.length ? ` (bỏ ${bulk.length - okRows.length} dòng lỗi)` : ""}` : "Chưa có dòng hợp lệ"}
          </button>
        </div>
      )}
    </div>
  );
}
