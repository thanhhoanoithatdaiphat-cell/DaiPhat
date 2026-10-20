import { useEffect, useState } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { VN } from "@/lib/vn-time";

function useFace() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const date = new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  return { time, date };
}

export function Landing() {
  const face = useFace();
  return (
    <div className="theme-dark tech-stage flex min-h-dvh justify-center text-ink">
      <div className="flex w-full max-w-md flex-col">
        <header className="safe-top relative overflow-hidden hero-dark px-6 pb-12 text-ink">
          <div className="flex items-center gap-3"><img src="/punch-logo.png" alt="Đại Phát Furniture" className="size-14 rounded-full" /><p className="text-sm font-semibold text-ice">Vào Ca · Đại Phát</p></div>
          <h1 className="font-display mt-8 text-[5.25rem] leading-[0.88] font-bold tracking-tight">
            Đúng chỗ
            <br />
            mới là
            <br />
            <span className="text-ice">đúng giờ.</span>
          </h1>
          <p className="mt-6 font-display text-2xl font-medium tabular-nums text-ink/70">
            {face.time}
            <span className="px-2 text-ink/30">/</span>
            <span className="font-sans text-sm">{face.date}</span>
          </p>
          <span
            className="absolute inset-x-0 bottom-0 h-4"
            style={{ background: "repeating-linear-gradient(90deg, var(--color-ice) 0 2px, transparent 2px 12px)" }}
            aria-hidden="true"
          />
        </header>
        <section className="flex flex-1 flex-col bg-card px-6 pt-7 pb-8 text-ink">
          <AuthPanel />
        </section>
      </div>
    </div>
  );
}
