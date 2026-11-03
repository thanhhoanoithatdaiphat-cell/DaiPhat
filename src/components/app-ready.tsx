import { useEffect } from "react";

/** Báo cho tập lệnh "máy quá cũ" trong <head> (routes/__root.tsx) biết ứng dụng đã chạy được. */
export function AppReady() {
  useEffect(() => {
    document.documentElement.setAttribute("data-app-ready", "1");
    document.getElementById("vaoca-old-browser")?.remove();
  }, []);
  return null;
}
