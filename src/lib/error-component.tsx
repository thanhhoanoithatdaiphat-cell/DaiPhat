import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

/** Lỗi tải file JS cũ sau khi có bản deploy mới (trình duyệt còn giữ trang cũ). */
function isStaleChunkError(error: unknown): boolean {
  const msg = errorMessage(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

const RELOAD_KEY = "stale-chunk-reload-at";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const stale = isStaleChunkError(error);

  // Tự tải lại đúng 1 lần (chặn lặp vô hạn nếu lỗi thật): lấy bản mới nhất rồi vào thẳng app.
  useEffect(() => {
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [stale]);

  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{stale ? "Có bản cập nhật mới" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {stale ? "Đang tải lại để lấy bản mới nhất. Nếu không tự tải lại, bấm nút bên dưới." : errorMessage(error)}
      </p>
      {stale ? (
        <button
          type="button"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
          onClick={() => window.location.reload()}
        >
          Tải lại
        </button>
      ) : null}
    </main>
  );
}
