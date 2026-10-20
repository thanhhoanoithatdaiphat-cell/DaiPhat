import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";
import { errorText } from "@/components/ui";
import { signOut } from "@/lib/auth/client";
import { getWorkspace, listCorrections, listLeaves } from "@/lib/attendance.functions";
import type { CorrectionRow, LeaveRow, WorkspaceData } from "@/lib/attendance-types";
import { EmployeesView } from "./employees";
import { HistoryView } from "./history";
import { InboxView } from "./inbox";
import { MonthView } from "./month";
import { OverviewView } from "./overview";
import { SettingsView } from "./settings";

export type AdminView = "overview" | "inbox" | "month" | "history" | "employees" | "settings";

export type AdminCtx = {
  data: WorkspaceData;
  corrections: CorrectionRow[];
  leaves: LeaveRow[];
  reload: () => Promise<void>;
  go: (view: AdminView) => void;
};

type AppUser = { displayName?: string | null; primaryEmail?: string | null };

export function AdminApp({ user, view, onView }: { user: AppUser; view: AdminView; onView: (v: AdminView) => void }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ws, list, leaveList] = await Promise.all([
        getWorkspace({ data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? "" } }),
        listCorrections(),
        listLeaves(),
      ]);
      setData(ws);
      setCorrections(list);
      setLeaves(leaveList);
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [user.displayName, user.primaryEmail]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 30000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  if (!data) {
    return (
      <main className="tech-stage grid min-h-dvh place-items-center px-6 text-center text-ink">
        <p className="text-sm text-muted">{error || "Đang mở bảng quản trị…"}</p>
      </main>
    );
  }

  const role = data.profile.role;
  if (role !== "admin" && role !== "approver") {
    return (
      <main className="tech-stage grid min-h-dvh place-items-center px-6 text-center text-ink">
        <div className="max-w-sm space-y-4">
          <p className="font-display text-4xl font-semibold">Trang dành cho quản trị và người duyệt</p>
          <p className="text-sm text-muted">Tài khoản của bạn chưa có quyền này. Nhờ quản trị cấp quyền "Người duyệt" nếu cần.</p>
          <Link to="/" className="btn-3d btn-3d-primary">
            Về trang chấm công
          </Link>
        </div>
      </main>
    );
  }

  const pendingTotal = corrections.filter((c) => c.status === "pending").length + leaves.filter((l) => l.status === "pending").length + data.overtimePending.length;
  const items: { id: AdminView; label: string; badge?: number }[] = [
    { id: "overview", label: "Tổng quan" },
    { id: "inbox", label: "Cần duyệt", badge: pendingTotal },
    { id: "month", label: "Bảng công" },
  ];
  if (role === "admin") {
    items.push({ id: "employees", label: "Nhân viên" });
    items.push({ id: "settings", label: "Cài đặt" });
  }
  // Lịch sử không có trong thiết kế chốt; giữ ở cuối menu để không mất chức năng.
  items.push({ id: "history", label: "Lịch sử" });
  const current = items.some((i) => i.id === view) ? view : "overview";
  const ctx: AdminCtx = { data, corrections, leaves, reload, go: onView };

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink lg:flex-row">
      <aside className="safe-top bg-night text-[#fff3d6] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-52 lg:shrink-0 lg:flex-col">
        <div className="flex items-center gap-3 px-4 pt-4 lg:pt-6">
          <img src="/punch-logo-dark.png" alt="" className="size-11 shrink-0 rounded-full bg-night-deep object-cover ring-2 ring-ice" />
          <div className="min-w-0">
            <p className="font-display text-2xl leading-none font-bold">VÀO CA</p>
            <p className="mt-1 truncate text-[0.7rem] font-semibold text-ice">{data.companyName}</p>
          </div>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-7 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Quản trị">
          {items.map((item) => {
            const active = item.id === current;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onView(item.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-semibold ${
                  active ? "bg-ice text-night" : "text-[#fff3d6]/85 hover:bg-white/10"
                }`}
              >
                {item.label}
                {item.badge ? (
                  <span className="ml-auto rounded-full bg-[#7a2e2a] px-2 py-px text-[0.7rem] font-bold text-[#fff3d6]">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="hidden border-t border-white/10 px-4 py-4 lg:block">
          <p className="truncate text-xs font-semibold">
            {role === "admin" ? "Quản trị" : "Người duyệt"} · {data.profile.fullName}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-[#fff3d6]/70">
            <Link to="/" className="inline-flex items-center gap-1 hover:text-[#fff3d6]">
              <Smartphone className="size-3.5" /> Bản chấm công
            </Link>
            <button
              type="button"
              disabled={signingOut}
              className="hover:text-[#fff3d6]"
              onClick={() => {
                setSigningOut(true);
                void signOut().catch(() => setSigningOut(false));
              }}
            >
              {signingOut ? "Đang thoát…" : "Đăng xuất"}
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {error ? <p className="mb-4 text-sm text-clay">{error}</p> : null}
        {current === "overview" ? <OverviewView ctx={ctx} /> : null}
        {current === "inbox" ? <InboxView ctx={ctx} /> : null}
        {current === "month" ? <MonthView ctx={ctx} /> : null}
        {current === "history" ? <HistoryView ctx={ctx} /> : null}
        {current === "employees" ? <EmployeesView ctx={ctx} /> : null}
        {current === "settings" ? <SettingsView ctx={ctx} /> : null}
      </main>
    </div>
  );
}
