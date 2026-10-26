import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PersonCard } from "@/components/panels";
import { errorText } from "@/components/ui";
import { LEFT_VISIBLE_DAYS, setEmployeeLeft } from "@/lib/attendance.functions";
import { InviteCodeCard } from "@/components/invite-card";
import { displayPhone, phoneFromLoginEmail } from "@/lib/phone";
import type { PersonRow, Role } from "@/lib/attendance-types";
import type { AdminCtx } from "./app";
import { compareByCode } from "@/lib/employee-order";
import { Card, Chip, PageHero, useClickAway } from "./common";

const ROLE_LABEL: Record<Role, string> = { employee: "Nhân viên", approver: "Người duyệt", admin: "Quản trị" };

type StatusFilter = "active" | "left" | "all";

function phoneOf(p: PersonRow): string {
  if (p.phone) return displayPhone(p.phone);
  const fromLogin = phoneFromLoginEmail(p.email);
  return fromLogin ? displayPhone(fromLogin) : (p.email ?? "—");
}

function fmtDate(key: string | null | undefined): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

export function EmployeesView({ ctx }: { ctx: AdminCtx }) {
  const { data, reload } = ctx;
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggleLeft(p: PersonRow, left: boolean) {
    if (left && !window.confirm(`Cho ${p.fullName} nghỉ việc từ hôm nay? Sau ${LEFT_VISIBLE_DAYS} ngày người này sẽ tự ẩn khỏi danh sách (dữ liệu công cũ vẫn giữ).`)) return;
    setError("");
    try {
      await setEmployeeLeft({ data: { userId: p.userId, left } });
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const people = data.teamToday;
  const activeCount = people.filter((p) => p.isActive !== false).length;
  const depts = useMemo(
    () => [...new Set(people.map((p) => p.department ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [people],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (status === "active" && p.isActive === false) return false;
      if (status === "left" && p.isActive !== false) return false;
      if (dept && (p.department ?? "") !== dept) return false;
      if (!q) return true;
      return [p.fullName, p.employeeCode ?? "", p.phone ?? "", p.jobTitle ?? ""].some((v) => v.toLowerCase().includes(q));
    }).sort(compareByCode);
  }, [people, query, dept, status]);
  const panelRef = useRef<HTMLElement>(null);
  useClickAway(panelRef, () => setOpenId(null), openId !== null);
  const open = openId ? people.find((p) => p.userId === openId) : undefined;
  const missingInfo = people.filter((p) => p.isActive !== false && (!p.employeeCode || !p.department)).length;

  return (
    <div className="space-y-4">
      <PageHero
        title="Nhân viên"
        subtitle={`${activeCount} đang làm việc · ${people.length - activeCount} đã nghỉ${missingInfo ? ` · ${missingInfo} người chưa đủ mã NV hoặc phòng ban` : ""}`}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tên, mã NV, số điện thoại"
                aria-label="Tìm nhân viên"
                className="h-10 w-60 rounded-md border border-edge bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ice"
              />
            </label>
            {depts.length ? (
              <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Lọc phòng ban" className="h-10 rounded-md border border-edge bg-card px-3 text-sm">
                <option value="">Tất cả phòng ban</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex overflow-hidden rounded-md border border-edge text-sm font-semibold" role="group" aria-label="Trạng thái">
              {(
                [
                  ["active", "Đang làm"],
                  ["left", "Đã nghỉ"],
                  ["all", "Tất cả"],
                ] as const
              ).map(([k, t]) => (
                <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={`h-9 px-3 ${status === k ? "bg-ink text-card" : "bg-card"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <Card>
            {shown.length === 0 ? (
              <p className="px-5 py-10 text-sm text-muted">Không có nhân viên khớp bộ lọc.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-semibold text-muted uppercase">
                      <th className="px-4 py-2">Nhân viên</th>
                      <th className="px-2 py-2">Mã NV</th>
                      <th className="px-2 py-2">Phòng ban</th>
                      <th className="px-2 py-2">Chức danh</th>
                      <th className="px-2 py-2">Vai trò</th>
                      <th className="px-2 py-2">Vào làm</th>
                      <th className="px-4 py-2">Trạng thái</th>
                      <th className="px-4 py-2 text-center">Nghỉ việc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr
                        key={p.userId}
                        tabIndex={0}
                        className={`cursor-pointer border-t border-line hover:bg-paper focus-visible:bg-paper ${openId === p.userId ? "bg-ice/25" : ""}`}
                        onClick={() => setOpenId(p.userId)}
                        onKeyDown={(e) => e.key === "Enter" && setOpenId(p.userId)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sand font-display text-lg font-semibold">{p.fullName.charAt(0).toUpperCase()}</span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{p.fullName}{p.userId === data.profile.userId ? " (bạn)" : ""}</p>
                              <p className="text-xs text-muted">{phoneOf(p)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 tabular-nums">{p.employeeCode ?? <span className="text-clay">Thiếu</span>}</td>
                        <td className="px-2 py-2.5">{p.department ?? <span className="text-clay">Thiếu</span>}</td>
                        <td className="px-2 py-2.5 text-muted">{p.jobTitle ?? "—"}</td>
                        <td className="px-2 py-2.5">
                          <Chip tone={p.role === "admin" ? "ink" : p.role === "approver" ? "late" : "muted"}>{ROLE_LABEL[p.role]}</Chip>
                        </td>
                        <td className="px-2 py-2.5 tabular-nums text-muted">{fmtDate(p.startedOn)}</td>
                        <td className="px-4 py-2.5">
                          {p.isActive === false ? <Chip tone="clay">Đã nghỉ {p.endedOn ? fmtDate(p.endedOn) : ""}</Chip> : <Chip tone="ok">Đang làm</Chip>}
                        </td>
                        <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="size-5 accent-[var(--color-clay)]"
                            checked={p.isActive === false}
                            disabled={p.userId === data.profile.userId}
                            aria-label={`Nghỉ việc: ${p.fullName}`}
                            onChange={(e) => void toggleLeft(p, e.target.checked)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <InviteCodeCard />
          <p className="text-xs text-muted">Nhân viên mới tự đăng ký bằng số điện thoại và mã mời, rồi xuất hiện ở đây. Bấm một dòng để điền mã NV, phòng ban, vai trò. Tích ô "Nghỉ việc" khi có người nghỉ: sau 15 ngày người đó tự ẩn khỏi danh sách (dữ liệu công cũ vẫn giữ để tính lương).</p>
        </div>
      </div>

      {open ? (
        <aside ref={panelRef} className="fixed inset-y-0 right-0 z-30 w-full overflow-y-auto border-l-2 border-ink bg-paper p-5 shadow-2xl sm:w-[26rem]" aria-label="Hồ sơ nhân viên">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-3xl font-semibold">Hồ sơ</h2>
            <button type="button" aria-label="Đóng" className="grid size-9 place-items-center rounded-md border border-edge bg-card" onClick={() => setOpenId(null)}>
              <X className="size-5" />
            </button>
          </div>
          <PersonCard key={open.userId} person={open} selfId={data.profile.userId} onChanged={reload} defaultOpen />
        </aside>
      ) : null}
    </div>
  );
}
