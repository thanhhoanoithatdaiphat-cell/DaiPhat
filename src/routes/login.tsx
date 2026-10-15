import { createFileRoute, Link } from "@tanstack/react-router";
import { Landing } from "@/components/landing";
import { primaryBtn } from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <div className="tech-stage min-h-dvh" />;
  if (!user) return <Landing />;
  return (
    <main className="tech-stage grid min-h-dvh place-items-center px-6 text-ink">
      <div className="w-full max-w-sm space-y-6 text-center">
        <p className="text-xs font-medium tracking-widest text-ice">VÀO CA</p>
        <p className="text-3xl font-light">Bạn đang trong ca.</p>
        <Link to="/" className={primaryBtn}>
          Mở bảng công
        </Link>
      </div>
    </main>
  );
}
