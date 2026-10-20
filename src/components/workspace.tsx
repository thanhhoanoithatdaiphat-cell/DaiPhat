import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ClipboardList, Clock, Settings2, Trophy, UserRound } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import type { AppUser } from "@/lib/auth/use-current-user";
import { getWorkspace } from "@/lib/attendance.functions";
import type { WorkspaceData } from "@/lib/attendance-types";
import { HistoryPanel, ManagePanel, ProfilePanel, PunchPanel, RankPanel, RequestsPanel } from "@/components/panels";
import { errorText } from "@/components/ui";

type Tab = "punch" | "history" | "requests" | "ranks" | "profile" | "manage";

const TAB_TITLE: Record<Tab, string> = {
  punch: "Chấm công",
  history: "Lịch sử",
  requests: "Đơn sửa công",
  ranks: "Xếp hạng",
  profile: "Hồ sơ",
  manage: "Quản trị",
};

export function Workspace({ user }: { user: AppUser }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("punch");

  const load = useCallback(async () => {
    const next = await getWorkspace({
      data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? "" },
    });
    setData(next);
    setError("");
  }, [user.displayName, user.primaryEmail]);

  useEffect(() => {
    let cancelled = false;
    getWorkspace({
      data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? "" },
    })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user.displayName, user.primaryEmail]);

  const canReview = data?.profile.role === "admin" || data?.profile.role === "approver";
  const showRanks = Boolean(data?.settings.rankingsEnabled);
  const items: { id: Tab; label: string; icon: typeof Clock }[] = [
    { id: "punch", label: "Chấm công", icon: Clock },
    { id: "history", label: "Lịch sử", icon: CalendarDays },
    { id: "requests", label: "Đơn", icon: ClipboardList },
    { id: "profile", label: "Hồ sơ", icon: UserRound },
  ];
  if (showRanks) items.push({ id: "ranks", label: "Hạng", icon: Trophy });
  if (canReview) items.push({ id: "manage", label: data?.profile.role === "admin" ? "Quản trị" : "Đội", icon: Settings2 });

  const punching = tab === "punch";

  return (
    <div className="theme-dark flex h-dvh justify-center bg-paper">
      <div className="flex h-full w-full max-w-md flex-col bg-paper md:max-w-3xl lg:max-w-4xl">
        {punching ? null : (
          <header className="safe-top flex items-center justify-between gap-3 border-b border-line bg-card px-5 pb-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{data?.companyName ?? "VÀO CA"}</p>
              <p className="truncate font-display text-3xl font-semibold">{TAB_TITLE[tab]}</p>
            </div>
            <div className="account-compact shrink-0">
              <UserButton />
            </div>
          </header>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="px-4 pt-4 text-sm text-clay">{error}</p> : null}
          {!data && !error ? <p className="px-5 pt-8 text-sm text-muted">Đang mở bảng công…</p> : null}
          {data && punching ? <PunchPanel data={data} onChanged={load} onRequests={() => setTab("requests")} /> : null}
          {data && tab === "history" ? (
            <div className="px-4 py-4">
              <HistoryPanel settings={data.settings} />
            </div>
          ) : null}
          {data && tab === "requests" ? (
            <div className="px-4 py-4">
              <RequestsPanel
                canReview={Boolean(canReview)}
                maxCorrections={data.settings.maxCorrections}
                userId={data.profile.userId}
                onChanged={load}
              />
            </div>
          ) : null}
          {data && tab === "profile" ? (
            <div className="px-4 py-4">
              <ProfilePanel data={data} onChanged={load} />
            </div>
          ) : null}
          {data && tab === "ranks" ? (
            <div className="px-4 py-4">
              <RankPanel />
            </div>
          ) : null}
          {data && tab === "manage" ? (
            <div className="px-4 py-4">
              <ManagePanel data={data} onChanged={load} />
            </div>
          ) : null}
        </main>
        <nav className="tabbar shrink-0 border-t border-line bg-card" aria-label="Tính năng">
          <div className="flex">
            {items.map((item) => (
              <TabButton
                key={item.id}
                item={item}
                active={tab === item.id}
                badge={
                  item.id === "requests"
                    ? data?.pendingCount ?? 0
                    : item.id === "manage"
                      ? (data?.offsiteToday.length ?? 0) +
                        (data?.lateToday.length ?? 0) +
                        (data?.overtimePending.length ?? 0)
                      : 0
                }
                onClick={() => setTab(item.id)}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function TabButton({
  item,
  active,
  badge,
  onClick,
}: {
  item: { id: Tab; label: string; icon: typeof Clock };
  active: boolean;
  badge: number;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs tracking-wide md:min-h-16 md:text-sm ${active ? "font-semibold text-ice" : "text-muted"}`}
    >
      <span className="relative">
        <Icon className="size-5" strokeWidth={active ? 2 : 1.5} />
        {badge > 0 ? (
          <span className="absolute -top-1.5 -right-2 grid min-w-4 place-items-center rounded-full bg-clay px-1.5 text-xs font-semibold text-card">
            {badge}
          </span>
        ) : null}
      </span>
      {item.label}
    </button>
  );
}
