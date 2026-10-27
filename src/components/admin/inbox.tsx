import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { errorText } from "@/components/ui";
import { reviewCorrection, reviewLeave, reviewOvertime, reviewOvertimeRequest } from "@/lib/attendance.functions";
import type { CorrectionRow, LeaveRow, OvertimeRequestRow, PunchRow } from "@/lib/attendance-types";
import { formatMeters, minutesToHm, vnDateKey, vnTime } from "@/lib/vn-time";
import type { AdminCtx } from "./app";
import { ago, Card, Chip, KIND_LABEL, LEAVE_LABEL, PageHero, PunchPhoto, shortDate } from "./common";

type Item =
  | { key: string; kind: "correction"; id: number; userId: string; name: string; at: string; row: CorrectionRow }
  | { key: string; kind: "overtime"; id: number; userId: string; name: string; at: string; row: PunchRow }
  | { key: string; kind: "leave"; id: number; userId: string; name: string; at: string; row: LeaveRow }
  | { key: string; kind: "otreq"; id: number; userId: string; name: string; at: string; row: OvertimeRequestRow };

type Tab = "all" | "correction" | "leave" | "overtime" | "done";

type Decided = {
  key: string;
  name: string;
  text: string;
  status: "approved" | "rejected";
  by: string | null;
  at: string | null;
  note: string | null;
};

export function InboxView({ ctx }: { ctx: AdminCtx }) {
  const { data, corrections, leaves, overtimeRequests, reload } = ctx;
  const selfId = data.profile.userId;
  const [tab, setTab] = useState<Tab>("all");
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);

  const pending = useMemo<Item[]>(() => {
    const a: Item[] = corrections
      .filter((c) => c.status === "pending")
      .map((c) => ({ key: `c${c.id}`, kind: "correction", id: c.id, userId: c.userId, name: c.fullName, at: c.createdAt, row: c }));
    const b: Item[] = data.overtimePending.map((r) => ({
      key: `o${r.id}`,
      kind: "overtime",
      id: r.id,
      userId: r.userId ?? "",
      name: r.fullName ?? "",
      at: r.punchedAt,
      row: r,
    }));
    const c: Item[] = leaves
      .filter((l) => l.status === "pending")
      .map((l) => ({ key: `l${l.id}`, kind: "leave", id: l.id, userId: l.userId, name: l.fullName, at: l.createdAt, row: l }));
    const d: Item[] = overtimeRequests
      .filter((o) => o.status === "pending")
      .map((o) => ({ key: `r${o.id}`, kind: "otreq", id: o.id, userId: o.userId, name: o.fullName, at: o.createdAt, row: o }));
    return [...a, ...b, ...c, ...d].sort((x, y) => y.at.localeCompare(x.at));
  }, [corrections, leaves, overtimeRequests, data.overtimePending]);

  const info = useMemo(() => new Map(data.teamToday.map((p) => [p.userId, p])), [data.teamToday]);
  const needle = query.trim().toLowerCase();
  const decided = useMemo<Decided[]>(() => {
    const a: Decided[] = corrections
      .filter((c) => c.status !== "pending")
      .map((c) => ({
        key: `c${c.id}`,
        name: c.fullName,
        text: `${KIND_LABEL[c.kind] ?? c.kind} · ${shortDate(c.attendanceDate)} · ${c.punchType === "in" ? "vào" : "ra"} ${c.requestedTime}`,
        status: c.status as "approved" | "rejected",
        by: c.reviewedByName,
        at: c.reviewedAt,
        note: c.reviewNote,
      }));
    const b: Decided[] = leaves
      .filter((l) => l.status !== "pending")
      .map((l) => ({
        key: `l${l.id}`,
        name: l.fullName,
        text: `${LEAVE_LABEL[l.kind] ?? l.kind} · ${shortDate(l.leaveDate)}`,
        status: l.status as "approved" | "rejected",
        by: l.reviewedByName,
        at: l.reviewedAt,
        note: l.reviewNote,
      }));
    const c: Decided[] = overtimeRequests
      .filter((o) => o.status !== "pending")
      .map((o) => ({
        key: `r${o.id}`,
        name: o.fullName,
        text: `Đơn tăng ca · ${shortDate(o.workDate)} · ${o.startTime}–${o.endTime} (${minutesToHm(o.minutes)})`,
        status: o.status as "approved" | "rejected",
        by: o.reviewedByName,
        at: o.reviewedAt,
        note: o.reviewNote,
      }));
    return [...a, ...b, ...c]
      .filter((d) => !needle || d.name.toLowerCase().includes(needle))
      .sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));
  }, [corrections, leaves, overtimeRequests, needle]);
  const list = pending.filter((i) => (tab === "all" || i.kind === tab || (tab === "overtime" && i.kind === "otreq")) && (!needle || i.name.toLowerCase().includes(needle)));
  const safeCursor = Math.min(cursor, Math.max(0, list.length - 1));
  const current = tab === "done" ? undefined : list[safeCursor];

  const targets = (): Item[] => {
    const picked = list.filter((i) => checked.has(i.key));
    return picked.length ? picked : current ? [current] : [];
  };

  async function decide(items: Item[], decision: "approved" | "rejected", reason: string) {
    const usable = items.filter((i) => i.userId !== selfId);
    if (usable.length === 0) {
      setMessage("Không thể tự duyệt mục của chính mình.");
      return;
    }
    setBusy(true);
    setMessage("");
    const results = await Promise.allSettled(
      usable.map((i) =>
        i.kind === "correction"
          ? reviewCorrection({ data: { id: i.id, decision, reviewNote: reason } })
          : i.kind === "leave"
            ? reviewLeave({ data: { id: i.id, decision, reviewNote: reason } })
            : i.kind === "otreq"
              ? reviewOvertimeRequest({ data: { id: i.id, decision, reviewNote: reason } })
              : reviewOvertime({ data: { id: i.id, decision } }),
      ),
    );
    const failed = results.flatMap((r, idx) => (r.status === "rejected" ? [`${usable[idx].name}: ${errorText(r.reason)}`] : []));
    const okCount = results.length - failed.length;
    setMessage(
      [okCount ? `Đã ${decision === "approved" ? "duyệt" : "từ chối"} ${okCount} mục.` : "", ...failed].filter(Boolean).join(" "),
    );
    setChecked(new Set());
    setRejecting(false);
    setNote("");
    await reload();
    setBusy(false);
  }

  const stateRef = useRef({ list, safeCursor, rejecting, busy, targets, decide });
  stateRef.current = { list, safeCursor, rejecting, busy, targets, decide };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = stateRef.current;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, s.list.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "x" && s.list[s.safeCursor]) {
        const key = s.list[s.safeCursor].key;
        setChecked((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      } else if (e.key === "a" && !s.busy && s.targets().length) {
        void s.decide(s.targets(), "approved", "");
      } else if (e.key === "r" && s.targets().length) {
        e.preventDefault();
        setRejecting(true);
        window.setTimeout(() => noteRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "all", label: "Tất cả", count: pending.length },
    { id: "correction", label: "Sửa công", count: pending.filter((i) => i.kind === "correction").length },
    { id: "leave", label: "Nghỉ phép", count: pending.filter((i) => i.kind === "leave").length },
    { id: "overtime", label: "Tăng ca", count: pending.filter((i) => i.kind === "overtime" || i.kind === "otreq").length },
    { id: "done", label: "Đã xử lý" },
  ];
  const picked = list.filter((i) => checked.has(i.key));

  return (
    <div className="space-y-4">
      <PageHero
        title="Cần duyệt"
        subtitle={`${pending.length} mục đang chờ · Phím tắt: J/K chọn dòng · X đánh dấu · A duyệt · R từ chối`}
      />

      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setCursor(0);
              setChecked(new Set());
              setRejecting(false);
            }}
            className={`rounded-md border border-edge px-3 py-1.5 text-sm font-semibold ${tab === t.id ? "bg-night text-ice" : "bg-card"}`}
          >
            {t.label}
            {t.count ? <span className={`ml-2 ${tab === t.id ? "text-ice" : "text-clay"}`}>{t.count}</span> : null}
          </button>
        ))}
        <label className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Tìm tên nhân viên"
            aria-label="Tìm tên nhân viên"
            className="h-10 w-48 rounded-md border border-edge bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice"
          />
        </label>
      </div>

      {message ? <p className="rounded-md bg-sand px-4 py-2 text-sm">{message}</p> : null}

      {tab === "done" ? (
        <Card>
          {decided.length === 0 ? (
            <p className="px-5 py-10 text-sm text-muted">Chưa có đơn nào được xử lý.</p>
          ) : (
            <ul>
              {decided.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 first:border-t-0">
                  <span className="min-w-36 font-medium">{c.name}</span>
                  <span className="text-sm text-muted">{c.text}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Chip tone={c.status === "approved" ? "ok" : "clay"}>{c.status === "approved" ? "Đã duyệt" : "Từ chối"}</Chip>
                    <span className="text-xs text-muted">
                      {c.by ?? "—"}
                      {c.at ? ` · ${ago(c.at)}` : ""}
                    </span>
                  </span>
                  {c.note ? <p className="w-full text-sm text-muted">Ghi chú: {c.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <p className="px-5 py-14 text-center font-display text-3xl font-semibold">Đã xử lý hết</p>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={picked.length === list.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(list.map((i) => i.key)) : new Set())}
                />
                Chọn tất cả
              </label>
              <span className="text-muted">{picked.length ? `${picked.length} đã chọn` : `${list.length} mục`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold text-muted uppercase">
                    <th className="w-10 px-4 py-2" />
                    <th className="px-2 py-2">Loại đơn</th>
                    <th className="px-2 py-2">Nhân viên</th>
                    <th className="px-2 py-2">Nội dung</th>
                    <th className="px-4 py-2 text-right">Gửi</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((i, idx) => {
                    const who = info.get(i.userId);
                    return (
                      <tr
                        key={i.key}
                        className={`cursor-pointer border-t border-line ${idx === safeCursor ? "bg-ice/25 shadow-[inset_4px_0_0_var(--color-ink)]" : "hover:bg-paper"}`}
                        onClick={() => {
                          setCursor(idx);
                          setRejecting(false);
                        }}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-ink"
                            checked={checked.has(i.key)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() =>
                              setChecked((prev) => {
                                const next = new Set(prev);
                                if (next.has(i.key)) next.delete(i.key);
                                else next.add(i.key);
                                return next;
                              })
                            }
                            aria-label={`Chọn ${i.name}`}
                          />
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <Chip tone="ink">{i.kind === "correction" ? "Sửa công" : i.kind === "leave" ? "Nghỉ phép" : i.kind === "otreq" ? "Đơn tăng ca" : "Tăng ca"}</Chip>
                        </td>
                        <td className="px-2 py-3">
                          <p className="font-medium">{i.name}</p>
                          <p className="text-xs text-muted">{[who?.employeeCode, who?.department].filter(Boolean).join(" · ") || "—"}</p>
                        </td>
                        <td className="px-2 py-3 text-muted">{summary(i)}</td>
                        <td className="px-4 py-3 text-right text-xs whitespace-nowrap text-muted">{ago(i.at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-3 lg:sticky lg:top-4">
            {picked.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-ink p-3 text-card">
                <span className="mr-auto text-sm font-semibold">{picked.length} mục đã chọn</span>
                <button type="button" disabled={busy} className="rounded-md bg-ice px-4 py-2 text-sm font-semibold text-ink" onClick={() => void decide(picked, "approved", "")}>
                  Duyệt {picked.length} mục
                </button>
                <button type="button" disabled={busy} className="rounded-md bg-card px-4 py-2 text-sm font-semibold text-ink" onClick={() => setRejecting(true)}>
                  Từ chối
                </button>
              </div>
            ) : null}
            {current ? (
              <Card title={current.name}>
                <div className="space-y-4 p-5">
                  <Detail item={current} />
                  {current.userId === selfId ? (
                    <p className="text-sm text-muted">Đây là mục của bạn, cần người duyệt khác xử lý.</p>
                  ) : rejecting ? (
                    <div className="space-y-2">
                      <input
                        ref={noteRef}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void decide(targets(), "rejected", note);
                          if (e.key === "Escape") setRejecting(false);
                        }}
                        placeholder="Lý do từ chối (không bắt buộc), Enter để xác nhận"
                        className="h-11 w-full rounded-md border border-edge bg-card px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice"
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} className="btn-3d btn-3d-secondary flex-1" onClick={() => void decide(targets(), "rejected", note)}>
                          Xác nhận từ chối
                        </button>
                        <button type="button" className="px-3 text-sm text-muted underline" onClick={() => setRejecting(false)}>
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button type="button" disabled={busy} className="btn-3d btn-3d-primary flex-1" onClick={() => void decide([current], "approved", "")}>
                        <Check className="size-5" /> Duyệt <kbd className="text-xs opacity-60">A</kbd>
                      </button>
                      <button type="button" disabled={busy} className="btn-3d btn-3d-secondary flex-1" onClick={() => setRejecting(true)}>
                        <X className="size-5" /> Từ chối <kbd className="text-xs opacity-60">R</kbd>
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function summary(i: Item): string {
  if (i.kind === "correction") {
    const c = i.row;
    return `${KIND_LABEL[c.kind] ?? c.kind} · ${shortDate(c.attendanceDate)} · xin ${c.punchType === "in" ? "vào" : "ra"} ${c.requestedTime}`;
  }
  if (i.kind === "leave") return `${LEAVE_LABEL[i.row.kind] ?? i.row.kind} · ngày ${shortDate(i.row.leaveDate)}`;
  if (i.kind === "otreq") return `${i.row.startTime}–${i.row.endTime} · ${shortDate(i.row.workDate)} · tính ${minutesToHm(i.row.minutes)}`;
  return `Tăng ca ${minutesToHm(i.row.overtimeMinutes)} · ${shortDate(vnDateKey(i.row.punchedAt))}`;
}

function Detail({ item }: { item: Item }) {
  if (item.kind === "correction") {
    const c = item.row;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="ink">Sửa công</Chip>
          <Chip tone="muted">{KIND_LABEL[c.kind] ?? c.kind}</Chip>
        </div>
        <p className="font-display text-4xl leading-tight font-semibold">
          Xin chấm {c.punchType === "in" ? "vào" : "ra"} lúc {c.requestedTime}
        </p>
        <p className="text-sm text-muted">Ngày {shortDate(c.attendanceDate)} · gửi {ago(c.createdAt)}</p>
        <blockquote className="border-l-4 border-ice bg-paper px-4 py-3 text-sm">{c.note}</blockquote>
      </div>
    );
  }
  if (item.kind === "leave") {
    const l = item.row;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="ink">Nghỉ phép</Chip>
          <Chip tone="muted">{LEAVE_LABEL[l.kind] ?? l.kind}</Chip>
        </div>
        <p className="font-display text-4xl leading-tight font-semibold">Xin nghỉ ngày {shortDate(l.leaveDate)}</p>
        <p className="text-sm text-muted">Gửi {ago(l.createdAt)}. Duyệt xong, ngày này hiện trong bảng công là nghỉ có phép và không tính vắng.</p>
        <blockquote className="border-l-4 border-ice bg-paper px-4 py-3 text-sm">{l.note}</blockquote>
      </div>
    );
  }
  if (item.kind === "otreq") {
    const o = item.row;
    return (
      <div className="space-y-3">
        <Chip tone="ink">Đơn tăng ca</Chip>
        <p className="font-display text-4xl leading-tight font-semibold">
          {o.startTime}–{o.endTime}
        </p>
        <p className="text-sm text-muted">
          Ngày {shortDate(o.workDate)} · gửi {ago(o.createdAt)}. Duyệt xong, {minutesToHm(o.minutes)} được cộng vào tăng ca của tháng (chỉ tính phần giờ nghỉ trưa).
        </p>
        <blockquote className="border-l-4 border-ice bg-paper px-4 py-3 text-sm">{o.note}</blockquote>
      </div>
    );
  }
  const r = item.row;
  return (
    <div className="space-y-3">
      <Chip tone="ink">Tăng ca</Chip>
      <p className="font-display text-4xl leading-tight font-semibold">Tăng ca {minutesToHm(r.overtimeMinutes)}</p>
      <p className="text-sm text-muted">
        Ra ca lúc {vnTime(r.punchedAt)} ngày {shortDate(vnDateKey(r.punchedAt))}
        {r.nearestName ? ` · ${r.nearestName}` : ""}
        {r.distanceMeters != null ? ` · cách ${formatMeters(r.distanceMeters)}` : ""}
      </p>
      {r.hasPhoto ? <PunchPhoto id={r.id} /> : <p className="text-sm text-muted">Không có ảnh</p>}
    </div>
  );
}
