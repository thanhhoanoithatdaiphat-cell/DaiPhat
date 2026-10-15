import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PersonRow } from "@/lib/attendance-types";
import { vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { Card, Chip } from "./common";

type Filter = "all" | "working" | "done" | "none" | "late";

export function OverviewView({ ctx }: { ctx: AdminCtx }) {
  const { data, corrections, go } = ctx;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const lateIds = useMemo(() => new Set(data.lateToday.map((r) => r.userId)), [data.lateToday]);
  const offsiteIds = useMemo(() => new Set(data.offsiteToday.map((r) => r.userId)), [data.offsiteToday]);
  const people = data.teamToday;
  const working = people.filter((p) => p.lastType === "in");
  const done = people.filter((p) => p.lastType === "out");
  const none = people.filter((p) => p.lastType === null);

  const stats: { id: Filter; label: string; value: number; tone: string }[] = [
    { id: "working", label: "Đang làm", value: working.length, tone: "text-ok" },
    { id: "done", label: "Đã ra ca", value: done.length, tone: "text-ink" },
    { id: "none", label: "Chưa vào", value: none.length, tone: "text-clay" },
    { id: "late", label: "Đi muộn", value: lateIds.size, tone: "text-ink" },
  ];

  const shown = people.filter((p) => {
    if (query && !p.fullName.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "working") return p.lastType === "in";
    if (filter === "done") return p.lastType === "out";
    if (filter === "none") return p.lastType === null;
    if (filter === "late") return lateIds.has(p.userId);
    return true;
  });

  const pending = [
    ...corrections.filter((c) => c.status === "pending").map((c) => ({ key: `c${c.id}`, name: c.fullName, text: "Xin sửa công" })),
    ...data.overtimePending.map((r) => ({ key: `o${r.id}`, name: r.fullName ?? "", text: `Tăng ca ${r.overtimeMinutes} phút` })),
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-semibold">Tổng quan hôm nay</h1>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setFilter((f) => (f === s.id ? "all" : s.id))}
            className={`rounded-lg border-[1.5px] border-ink bg-card p-4 text-left ${filter === s.id ? "shadow-[0_4px_0_var(--color-ink)]" : ""}`}
            aria-pressed={filter === s.id}
          >
            <p className="text-sm text-muted">{s.label}</p>
            <p className={`font-display text-6xl leading-none font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
            {filter === s.id ? <span className="mt-1 block h-1 w-10 bg-ice" /> : null}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <Card
          title="Nhân viên"
          action={
            <label className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên"
                className="h-10 w-40 rounded-md border-[1.5px] border-ink bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice"
              />
            </label>
          }
        >
          {shown.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">Không có ai khớp bộ lọc.</p>
          ) : (
            <ul>
              {shown.map((p) => (
                <Row key={p.userId} p={p} late={lateIds.has(p.userId)} offsite={offsiteIds.has(p.userId)} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Cần xử lý"
          action={
            pending.length ? (
              <button type="button" className="text-sm font-semibold underline" onClick={() => go("inbox")}>
                Mở hộp thư
              </button>
            ) : null
          }
        >
          {pending.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">Không có gì chờ duyệt.</p>
          ) : (
            <ul>
              {pending.slice(0, 6).map((i) => (
                <li key={i.key} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 first:border-t-0">
                  <span className="truncate font-medium">{i.name}</span>
                  <span className="shrink-0 text-sm text-muted">{i.text}</span>
                </li>
              ))}
              {pending.length > 6 ? <li className="border-t border-line px-5 py-3 text-sm text-muted">Và {pending.length - 6} mục nữa</li> : null}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ p, late, offsite }: { p: PersonRow; late: boolean; offsite: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-line px-5 py-3 first:border-t-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sand font-display text-lg font-semibold">
        {p.fullName.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{p.fullName}</p>
        <p className="text-xs text-muted">{p.role === "admin" ? "Quản trị" : p.role === "approver" ? "Người duyệt" : "Nhân viên"}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {late ? <Chip tone="late">Muộn</Chip> : null}
        {offsite ? <Chip tone="clay">Ngoài vùng</Chip> : null}
        {p.lastType === "in" ? <Chip tone="ok">Đang làm từ {vnTime(p.lastAt!)}</Chip> : null}
        {p.lastType === "out" ? <Chip tone="ink">Ra ca {vnTime(p.lastAt!)}</Chip> : null}
        {p.lastType === null ? <Chip tone="muted">Chưa vào</Chip> : null}
      </div>
    </li>
  );
}
