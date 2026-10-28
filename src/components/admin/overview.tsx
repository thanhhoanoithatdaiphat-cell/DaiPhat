import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { errorText } from "@/components/ui";
import { exportTimesheet, reviewCorrection, reviewLeave, reviewOvertime, reviewOvertimeRequest } from "@/lib/attendance.functions";
import type { PersonRow } from "@/lib/attendance-types";
import { todayLong, vnDateKey, vnMonthKey, vnTime, minutesToHm } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { KIND_LABEL, LEAVE_LABEL, shortDate } from "./common";
import { groupOffsite, OffsiteDrawer } from "./offsite";

type Filter = "all" | "working" | "done" | "none" | "late";
type Status = "late" | "working" | "done" | "none";

type Pending = {
  key: string;
  kind: "correction" | "leave" | "overtime" | "otreq";
  id: number;
  userId: string;
  title: string;
  detail: string;
  at: string;
};

const STATUS_LABEL: Record<Status, string> = {
  late: "Đi muộn",
  working: "Đang làm",
  done: "Đã ra",
  none: "Chưa vào",
};

const STATUS_CLASS: Record<Status, string> = {
  late: "bg-[#fde3df] text-[#a3342a]",
  working: "bg-[#d5f2e3] text-[#1f6a49]",
  done: "bg-[#d5f2e3] text-[#1f6a49]",
  none: "bg-[#fbe9ad] text-[#7a5a00]",
};

function dateLine(): string {
  const weekday = todayLong().split(",")[0];
  const [y, m, d] = vnDateKey().split("-");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${d}/${m}/${y}`;
}

export function OverviewView({ ctx }: { ctx: AdminCtx }) {
  const { data, corrections, leaves, go, reload } = ctx;
  const overtimeRequests = ctx.overtimeRequests ?? [];
  const selfId = data.profile.userId;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [rejectKey, setRejectKey] = useState("");
  const [note, setNote] = useState("");
  const [offsiteOpen, setOffsiteOpen] = useState(false);

  const lateMin = data.settings.lateMinutes;
  const people = useMemo(() => data.teamToday.filter((p) => p.isActive !== false), [data.teamToday]);
  const departments = useMemo(
    () => [...new Set(people.map((p) => p.department).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, "vi")),
    [people],
  );

  const statusOf = (p: PersonRow): Status => {
    if (p.lastType === null) return "none";
    if ((p.firstInLate ?? 0) > 0 && (p.firstInLate ?? 0) >= lateMin) return "late";
    return p.lastType === "in" ? "working" : "done";
  };

  const inScope = people.filter((p) => !dept || p.department === dept);
  const working = inScope.filter((p) => p.lastType === "in");
  const done = inScope.filter((p) => p.lastType === "out");
  const none = inScope.filter((p) => p.lastType === null);
  const lateCount = inScope.filter((p) => statusOf(p) === "late").length;

  const offsiteGroups = useMemo(() => {
    const ids = new Set(inScope.map((p) => p.userId));
    return groupOffsite(data.offsiteToday.filter((r) => r.userId && ids.has(r.userId)), people);
  }, [data.offsiteToday, inScope, people]);

  const stats: { id: Filter; label: string; value: number; tone: string }[] = [
    { id: "working", label: "Đang làm", value: working.length, tone: "text-ice" },
    { id: "done", label: "Đã ra", value: done.length, tone: "text-[#fff3d6]" },
    { id: "none", label: "Chưa vào", value: none.length, tone: "text-[#fff3d6]" },
    { id: "late", label: "Đi muộn", value: lateCount, tone: "text-[#ff9c8a]" },
  ];

  const needle = query.trim().toLowerCase();
  const shown = inScope
    .filter((p) => {
      if (needle && !p.fullName.toLowerCase().includes(needle) && !(p.employeeCode ?? "").toLowerCase().includes(needle)) return false;
      if (filter === "working") return p.lastType === "in";
      if (filter === "done") return p.lastType === "out";
      if (filter === "none") return p.lastType === null;
      if (filter === "late") return statusOf(p) === "late";
      return true;
    })
    .sort((a, b) => {
      const la = statusOf(a) === "late" ? 0 : 1;
      const lb = statusOf(b) === "late" ? 0 : 1;
      if (la !== lb) return la - lb;
      if (!a.firstInAt && !b.firstInAt) return a.fullName.localeCompare(b.fullName, "vi");
      if (!a.firstInAt) return 1;
      if (!b.firstInAt) return -1;
      return a.firstInAt.localeCompare(b.firstInAt);
    });

  const offsiteIds = useMemo(() => new Set(data.offsiteToday.map((r) => r.userId)), [data.offsiteToday]);

  const pending = useMemo<Pending[]>(() => {
    const dayOf = (iso: string) => shortDate(vnDateKey(iso));
    const a: Pending[] = corrections
      .filter((c) => c.status === "pending")
      .map((c) => ({
        key: `c${c.id}`,
        kind: "correction",
        id: c.id,
        userId: c.userId,
        title: `Sửa công · ${c.fullName}`,
        detail:
          c.kind === "quen"
            ? `Quên chấm giờ ${c.punchType === "in" ? "vào" : "ra"} ngày ${shortDate(c.attendanceDate)}`
            : `${KIND_LABEL[c.kind] ?? c.kind} · xin giờ ${c.punchType === "in" ? "vào" : "ra"} ${c.requestedTime} ngày ${shortDate(c.attendanceDate)}`,
        at: c.createdAt,
      }));
    const b: Pending[] = leaves
      .filter((l) => l.status === "pending")
      .map((l) => ({
        key: `l${l.id}`,
        kind: "leave",
        id: l.id,
        userId: l.userId,
        title: `Nghỉ phép · ${l.fullName}`,
        detail: `${LEAVE_LABEL[l.kind] ?? "Nghỉ"}, ngày ${shortDate(l.leaveDate)}`,
        at: l.createdAt,
      }));
    const c: Pending[] = data.overtimePending.map((r) => ({
      key: `o${r.id}`,
      kind: "overtime",
      id: r.id,
      userId: r.userId ?? "",
      title: `Tăng ca · ${r.fullName ?? ""}`,
      detail: `Tăng ca ${minutesToHm(r.overtimeMinutes)} ngày ${dayOf(r.punchedAt)}`,
      at: r.punchedAt,
    }));
    const d: Pending[] = overtimeRequests
      .filter((o) => o.status === "pending")
      .map((o) => ({
        key: `r${o.id}`,
        kind: "otreq",
        id: o.id,
        userId: o.userId,
        title: `Đơn tăng ca · ${o.fullName}`,
        detail: `${o.startTime}–${o.endTime} ngày ${shortDate(o.workDate)} · tính ${minutesToHm(o.minutes)}`,
        at: o.createdAt,
      }));
    return [...a, ...b, ...c, ...d].sort((x, y) => y.at.localeCompare(x.at));
  }, [corrections, leaves, overtimeRequests, data.overtimePending]);

  async function decide(item: Pending, decision: "approved" | "rejected", reason: string) {
    setBusyKey(item.key);
    setMessage("");
    try {
      if (item.kind === "correction") await reviewCorrection({ data: { id: item.id, decision, reviewNote: reason } });
      else if (item.kind === "leave") await reviewLeave({ data: { id: item.id, decision, reviewNote: reason } });
      else if (item.kind === "otreq") await reviewOvertimeRequest({ data: { id: item.id, decision, reviewNote: reason } });
      else await reviewOvertime({ data: { id: item.id, decision } });
      setRejectKey("");
      setNote("");
      await reload();
    } catch (err) {
      setMessage(errorText(err));
    }
    setBusyKey("");
  }

  async function download() {
    setExporting(true);
    setMessage("");
    try {
      const file = await exportTimesheet({ data: vnMonthKey() });
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage(errorText(err));
    }
    setExporting(false);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-night p-5 text-[#fff3d6] lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl leading-tight font-bold lg:text-4xl">Tổng quan hôm nay</h1>
            <p className="mt-0.5 text-xs text-ice">{dateLine()} · tự làm mới mỗi 30 giây</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#a8977d]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên hoặc mã NV"
                aria-label="Tìm tên hoặc mã nhân viên"
                className="h-10 w-full rounded-lg border-0 bg-[#433427] pr-3 pl-9 text-sm text-[#fff3d6] outline-none placeholder:text-[#a8977d] focus-visible:ring-2 focus-visible:ring-ice sm:w-56"
              />
            </label>
            <button
              type="button"
              onClick={() => void download()}
              disabled={exporting}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-ice px-4 text-sm font-bold text-night disabled:opacity-60"
            >
              <Download className="size-4" /> {exporting ? "Đang xuất…" : "Xuất bảng công"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
          {stats.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setFilter((f) => (f === s.id ? "all" : s.id))}
              aria-pressed={filter === s.id}
              className="text-left"
            >
              <p className="text-xs text-[#fff3d6]/80">{s.label}</p>
              <p className={`font-display text-5xl leading-none font-bold tabular-nums ${s.tone}`}>{s.value}</p>
              <span className={`mt-1.5 block h-0.5 w-8 ${filter === s.id ? "bg-ice" : "bg-transparent"}`} />
            </button>
          ))}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOffsiteOpen((v) => !v)}
            aria-pressed={offsiteOpen}
            className="col-span-2 border-t border-[#fff3d6]/15 pt-4 text-left sm:col-span-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4"
          >
            <p className="text-xs text-[#fff3d6]/80">Ngoài điểm</p>
            <p className={`font-display text-5xl leading-none font-bold tabular-nums ${offsiteGroups.length ? "text-[#ffc247]" : "text-[#fff3d6]"}`}>{offsiteGroups.length}</p>
            <span className={`mt-1.5 block h-0.5 w-8 ${offsiteOpen ? "bg-ice" : "bg-transparent"}`} />
          </button>
        </div>
      </section>

      {offsiteOpen ? <OffsiteDrawer groups={offsiteGroups} allowOffsite={data.settings.allowOffsite} onClose={() => setOffsiteOpen(false)} /> : null}

      {message ? <p className="rounded-lg bg-sand px-4 py-2 text-sm text-ink">{message}</p> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="rounded-xl border border-line bg-card">
          <header className="flex items-center justify-between gap-3 px-5 py-3.5">
            <h2 className="font-display text-xl font-bold">Chấm công theo thời gian thực</h2>
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              aria-label="Lọc theo phòng ban"
              className="max-w-44 rounded-md bg-transparent text-xs text-muted outline-none"
            >
              <option value="">Tất cả phòng ban</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </header>
          {shown.length === 0 ? (
            <p className="border-t border-line px-5 py-8 text-sm text-muted">Không có ai khớp bộ lọc.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs font-semibold text-muted">
                    <th className="px-5 py-2.5">Nhân viên</th>
                    <th className="px-2 py-2.5">Phòng ban</th>
                    <th className="px-2 py-2.5">Giờ vào</th>
                    <th className="px-5 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const st = statusOf(p);
                    return (
                      <tr key={p.userId} className="border-t border-line first:border-t-0">
                        <td className="px-5 py-3">
                          <p className="font-semibold">{p.fullName}</p>
                          <p className="text-xs text-muted">{p.employeeCode || "—"}</p>
                        </td>
                        <td className="px-2 py-3">{p.department || "—"}</td>
                        <td className="px-2 py-3 font-display text-lg font-semibold tabular-nums">
                          {p.firstInAt ? vnTime(p.firstInAt) : "--:--"}
                        </td>
                        <td className="px-5 py-3">
                          <span className="flex flex-wrap gap-1.5">
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLASS[st]}`}>
                              {STATUS_LABEL[st]}
                            </span>
                            {offsiteIds.has(p.userId) ? (
                              <span className="inline-flex rounded-md bg-clay px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white">Ngoài vùng</span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-card">
          <header className="flex items-center justify-between gap-3 px-5 py-3.5">
            <h2 className="font-display text-xl font-bold">Cần duyệt</h2>
            <button type="button" className="text-xs font-semibold underline" onClick={() => go("inbox")}>
              Xem tất cả
            </button>
          </header>
          {pending.length === 0 ? (
            <p className="border-t border-line px-5 py-8 text-sm text-muted">Không có gì chờ duyệt.</p>
          ) : (
            <ul>
              {pending.slice(0, 5).map((i) => (
                <li key={i.key} className="border-t border-line px-5 py-3.5">
                  <p className="text-sm font-bold">{i.title}</p>
                  <p className="text-xs text-muted">{i.detail}</p>
                  {i.userId === selfId ? (
                    <p className="mt-2 text-xs text-muted">Mục của bạn, cần người duyệt khác xử lý.</p>
                  ) : rejectKey === i.key ? (
                    <div className="mt-2 space-y-2">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void decide(i, "rejected", note);
                          if (e.key === "Escape") setRejectKey("");
                        }}
                        autoFocus
                        placeholder="Lý do từ chối (không bắt buộc)"
                        className="h-9 w-full rounded-md border border-line bg-paper px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ice"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyKey === i.key}
                          onClick={() => void decide(i, "rejected", note)}
                          className="rounded-md border border-ink px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                        >
                          Xác nhận từ chối
                        </button>
                        <button type="button" className="text-xs text-muted underline" onClick={() => setRejectKey("")}>
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busyKey === i.key}
                        onClick={() => void decide(i, "approved", "")}
                        className="rounded-md bg-night px-4 py-1.5 text-xs font-bold text-ice disabled:opacity-60"
                      >
                        Duyệt
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === i.key}
                        onClick={() => {
                          setRejectKey(i.key);
                          setNote("");
                        }}
                        className="rounded-md border border-ink px-4 py-1.5 text-xs font-bold disabled:opacity-60"
                      >
                        Từ chối
                      </button>
                    </div>
                  )}
                </li>
              ))}
              {pending.length > 5 ? (
                <li className="border-t border-line px-5 py-3 text-xs text-muted">Và {pending.length - 5} mục nữa</li>
              ) : null}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
