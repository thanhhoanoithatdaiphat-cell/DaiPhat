import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight, ClipboardList, Clock, Settings2, Trophy, UserRound } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import type { AppUser } from "@/lib/auth/use-current-user";
import { getWorkspace, needsPasswordChange } from "@/lib/attendance.functions";
import { FirstLoginPassword } from "@/components/change-password";
import type { WorkspaceData } from "@/lib/attendance-types";
import { HistoryPanel, ManagePanel, ProfilePanel, PunchPanel, RankPanel, RequestsPanel } from "@/components/panels";
import { errorText } from "@/components/ui";

type Tab = "punch" | "history" | "requests" | "ranks" | "profile" | "manage";

const TAB_TITLE: Record<Tab, string> = {
  punch: "Chấm công",
  history: "Lịch sử",
  requests: "Đơn",
  ranks: "Xếp hạng",
  profile: "Cá nhân",
  manage: "Quản trị",
};

export function Workspace({ user }: { user: AppUser }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("punch");
  const [askPassword, setAskPassword] = useState(false);

  useEffect(() => {
    needsPasswordChange()
      .then((r) => setAskPassword(r.needed))
      .catch(() => {});
  }, []);

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
  const manageBadge =
    (data?.offsiteToday.length ?? 0) + (data?.lateToday.length ?? 0) + (data?.overtimePending.length ?? 0);
  const items: { id: Tab; label: string; icon: typeof Clock }[] = [
    { id: "punch", label: "Chấm công", icon: Clock },
    { id: "history", label: "Lịch sử", icon: CalendarDays },
    { id: "requests", label: "Đơn", icon: ClipboardList },
    { id: "profile", label: "Cá nhân", icon: UserRound },
  ];
  // Xếp hạng và Quản trị không còn nằm trên thanh dưới; mở từ tab Cá nhân.
  const profileTab = tab === "profile" || tab === "ranks" || tab === "manage";

  const punching = tab === "punch";

  return (
    <div className="theme-night flex h-dvh justify-center bg-paper">
      {askPassword ? <FirstLoginPassword onClose={() => setAskPassword(false)} /> : null}
      <div className="flex h-full w-full max-w-md flex-col bg-paper md:max-w-3xl lg:max-w-4xl">
        {punching ? null : (
          <header className="safe-top flex items-center justify-between gap-3 border-b border-line bg-night-deep px-5 pb-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ice">{data?.companyName ?? "VÀO CA"}</p>
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
          {data && punching ? <PunchPanel data={data} onChanged={load} onGoRequests={() => setTab("requests")} onGoHistory={() => setTab("history")} /> : null}
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
                workStart={data.settings.workStart}
                workEnd={data.settings.workEnd}
                settings={data.settings}
                onChanged={load}
              />
            </div>
          ) : null}
          {data && tab === "profile" ? (
            <div className="space-y-4 px-4 py-4">
              {showRanks || canReview ? (
                <div className="overflow-hidden rounded-xl border border-line bg-card">
                  {showRanks ? <ShortcutRow icon={Trophy} label="Xếp hạng" onClick={() => setTab("ranks")} /> : null}
                  {canReview ? (
                    <ShortcutRow
                      icon={Settings2}
                      label={data.profile.role === "admin" ? "Quản trị" : "Đội"}
                      badge={manageBadge}
                      onClick={() => setTab("manage")}
                    />
                  ) : null}
                </div>
              ) : null}
              <ProfilePanel data={data} onChanged={load} />
            </div>
          ) : null}
          {data && tab === "ranks" ? (
            <div className="px-4 py-4">
              <BackToProfile onClick={() => setTab("profile")} />
              <RankPanel selfId={data.profile.userId} />
            </div>
          ) : null}
          {data && tab === "manage" ? (
            <div className="px-4 py-4">
              <BackToProfile onClick={() => setTab("profile")} />
              <ManagePanel data={data} onChanged={load} />
            </div>
          ) : null}
        </main>
        <nav className="tabbar shrink-0 border-t border-line bg-night-deep" aria-label="Tính năng">
          <div className="flex">
            {items.map((item) => (
              <TabButton
                key={item.id}
                item={item}
                active={item.id === "profile" ? profileTab : tab === item.id}
                badge={item.id === "requests" ? data?.pendingCount ?? 0 : item.id === "profile" ? manageBadge : 0}
                onClick={() => setTab(item.id)}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function ShortcutRow({
  icon: Icon,
  label,
  badge = 0,
  onClick,
}: {
  icon: typeof Clock;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 border-t border-line px-4 text-left text-sm font-semibold text-ink first:border-t-0"
    >
      <Icon className="size-5 text-ice" strokeWidth={1.75} />
      <span className="flex-1">{label}</span>
      {badge > 0 ? <span className="rounded-full bg-clay px-2 text-xs font-semibold text-night">{badge}</span> : null}
      <ChevronRight className="size-4 text-muted" />
    </button>
  );
}

function BackToProfile({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 text-sm font-semibold text-ice">
      ← Cá nhân
    </button>
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
      aria-current={active ? "page" : undefined}
      className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.7rem] font-semibold whitespace-nowrap md:text-sm ${active ? "text-ice" : "text-muted"}`}
    >
      <span className="relative">
        <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
        {badge > 0 ? (
          <span className="absolute -top-1.5 -right-2.5 grid min-w-4 place-items-center rounded-full bg-clay px-1.5 text-[0.65rem] font-bold text-night">
            {badge}
          </span>
        ) : null}
      </span>
      {item.label}
    </button>
  );
}
