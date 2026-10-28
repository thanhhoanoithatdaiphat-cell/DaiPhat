import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Nút "Cài ứng dụng vào màn hình". Ẩn khi đã mở từ biểu tượng ứng dụng. */
export function InstallApp() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [env, setEnv] = useState<{ standalone: boolean; ios: boolean } | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setEnv({ standalone, ios });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!env || env.standalone) return null;
  if (installed) return <p className="rounded-md bg-ok/15 px-3 py-2 text-sm font-semibold text-ok">Đã cài. Hãy mở ứng dụng từ biểu tượng trên màn hình.</p>;

  async function install() {
    if (evt) {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setEvt(null);
    } else setHelp(true);
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void install()} className="flex h-12 w-full items-center justify-center gap-2 rounded-md border-2 border-ink bg-card text-base font-bold">
        <Download className="size-5" /> Cài ứng dụng vào màn hình
      </button>
      {help ? (
        <div className="rounded-md bg-sand px-3 py-2 text-sm leading-relaxed">
          {env.ios ? (
            <p>
              Trên iPhone: bấm nút Chia sẻ <Share className="inline size-4" /> của Safari, kéo xuống chọn <b>Thêm vào MH chính</b>, rồi bấm <b>Thêm</b>.
            </p>
          ) : (
            <p>
              Bấm dấu <b>⋮</b> (ba chấm) góc trên của Chrome, chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>. Nếu không thấy, hãy mở link này bằng Chrome.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
