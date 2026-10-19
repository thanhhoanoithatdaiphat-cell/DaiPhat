import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, History, Inbox, LayoutDashboard, Settings2, Smartphone, Users } from "lucide-react";
import { errorText } from "@/components/ui";
import { UserButton } from "@/lib/auth/gates";
import { getWorkspace, listCorrections, listLeaves } from "@/lib/attendance.functions";
import type { CorrectionRow, LeaveRow, WorkspaceData } from "@/lib/attendance-types";
import { todayLong } from "@/lib/vn-time";
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
  const items: { id: AdminView; label: string; icon: ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
    { id: "inbox", label: "Cần duyệt", icon: Inbox, badge: pendingTotal },
    { id: "month", label: "Bảng công", icon: CalendarDays },
    { id: "history", label: "Lịch sử", icon: History },
  ];
  if (role === "admin") {
    items.push({ id: "employees", label: "Nhân viên", icon: Users });
    items.push({ id: "settings", label: "Cài đặt", icon: Settings2 });
  }
  const current = items.some((i) => i.id === view) ? view : "overview";
  const ctx: AdminCtx = { data, corrections, leaves, reload, go: onView };

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink lg:flex-row">
      <aside className="safe-top bg-ink text-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between px-5 pt-4 lg:block lg:pt-6">
          <div>
            <p className="font-display text-3xl leading-none font-bold">
              Vào <span className="text-ice">Ca</span>
            </p>
            <p className="mt-1 truncate text-xs text-card/60">{data.companyName}</p>
          </div>
          <p className="text-xs font-semibold text-ice lg:mt-4">{role === "admin" ? "Quản trị" : "Người duyệt"}</p>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-8 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Quản trị">
          {items.map((item) => {
            const active = item.id === current;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onView(item.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold ${
                  active ? "bg-ice text-ink" : "text-card/75 hover:bg-card/10"
                }`}
              >
                <item.icon className="size-5" />
                {item.label}
                {item.badge ? (
                  <span className={`ml-auto rounded-full px-2 text-xs ${active ? "bg-ink text-ice" : "bg-clay text-card"}`}>{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="hidden px-5 pb-6 lg:block">
          <Link to="/" className="flex items-center gap-2 text-sm text-card/70 hover:text-card">
            <Smartphone className="size-4" /> Mở bản chấm công
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink bg-card px-5 py-3 lg:px-8">
          <p className="text-sm text-muted">{todayLong()}</p>
          <div className="account-compact shrink-0">
            <UserButton />
          </div>
        </header>
        <main className="p-4 lg:p-8">
          {error ? <p className="mb-4 text-sm text-clay">{error}</p> : null}
          {current === "overview" ? <OverviewView ctx={ctx} /> : null}
          {current === "inbox" ? <InboxView ctx={ctx} /> : null}
          {current === "month" ? <MonthView ctx={ctx} /> : null}
          {current === "history" ? <HistoryView ctx={ctx} /> : null}
          {current === "employees" ? <EmployeesView ctx={ctx} /> : null}
          {current === "settings" ? <SettingsView ctx={ctx} /> : null}
        </main>
      </div>
    </div>
  );
}
