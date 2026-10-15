import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Landing } from "@/components/landing";
import { AdminApp, type AdminView } from "@/components/admin/app";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const VIEWS: AdminView[] = ["overview", "inbox", "month", "settings"];

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { view: AdminView } => ({
    view: VIEWS.includes(search.view as AdminView) ? (search.view as AdminView) : "overview",
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, isPending } = useCurrentUserState();
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin" });
  if (isPending) {
    return (
      <main className="tech-stage grid min-h-dvh place-items-center px-6 text-center text-ink">
        <p className="text-sm text-muted">Đang mở…</p>
      </main>
    );
  }
  if (!user) return <Landing />;
  return <AdminApp user={user} view={view} onView={(next) => void navigate({ search: { view: next } })} />;
}
