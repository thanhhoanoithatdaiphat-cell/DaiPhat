import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { Landing } from "@/components/landing";
import { Workspace } from "@/components/workspace";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <main className="tech-stage grid min-h-dvh place-items-center px-6 text-center text-ink">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-widest text-muted">VÀO CA</p>
          <Clock className="mx-auto size-8" />
          <p className="text-sm text-muted">Đang mở ca làm việc…</p>
        </div>
      </main>
    );
  }
  if (!user) return <Landing />;
  return <Workspace user={user} />;
}
