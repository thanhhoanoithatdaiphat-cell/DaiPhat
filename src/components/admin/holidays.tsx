import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { errorText, fieldClass, primaryBtn } from "@/components/ui";
import { listHolidays, saveHoliday } from "@/lib/attendance.functions";
import type { HolidayRow } from "@/lib/attendance-types";
import { formatVnDay, vnDateKey } from "@/lib/vn-time";
import { Card } from "./common";

export function HolidayCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<HolidayRow[] | null>(null);
  const [date, setDate] = useState(vnDateKey());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await listHolidays());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveHoliday({ data: { date, name } });
      setName("");
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  async function remove(row: HolidayRow) {
    if (!window.confirm(`Xóa ngày lễ "${row.name}" (${fmt(row.date)})?`)) return;
    setError("");
    try {
      await saveHoliday({ data: { date: row.date, name: row.name, remove: true } });
      await load();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card title="Ngày lễ">
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted">Ngày lễ hiện chữ "L" trong bảng công và không tính vắng cho bất kỳ ai.</p>
        <form className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]" onSubmit={add}>
          <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Ngày lễ" />
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên, ví dụ Quốc khánh" maxLength={80} required aria-label="Tên ngày lễ" />
          <button className={primaryBtn} type="submit" disabled={busy}>
            Thêm
          </button>
        </form>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {rows == null ? <p className="text-sm text-muted">Đang tải…</p> : null}
        {rows && rows.length === 0 ? <p className="text-sm text-muted">Chưa khai báo ngày lễ nào.</p> : null}
        {rows && rows.length ? (
          <ul className="max-h-72 overflow-auto rounded-md border border-line">
            {rows.map((r) => (
              <li key={r.date} className="flex items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
                <span className="w-28 shrink-0 text-sm tabular-nums text-muted">{fmt(r.date)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <button type="button" aria-label={`Xóa ${r.name}`} className="grid size-9 place-items-center rounded-md text-muted hover:bg-sand hover:text-clay" onClick={() => void remove(r)}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function fmt(dateKey: string): string {
  return `${formatVnDay(dateKey)}/${dateKey.slice(0, 4)}`;
}
