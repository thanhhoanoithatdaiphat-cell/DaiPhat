import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const PHOTO_MAX = 180_000;
const VN_TZ = "Asia/Ho_Chi_Minh";

/** Thông tin ghi lên ảnh: toạ độ lấy lúc bấm chấm công, địa chỉ tra từ toạ độ. */
export type PhotoStamp = { lat: number; lng: number; placeName?: string | null };

function stampTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}:${get("second")} - ${get("day")}/${get("month")}/${get("year")}`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[,\s]+$/, "")}…`;
    return kept;
  }
  return lines;
}

/** Vẽ khối thông tin (địa chỉ, giờ, toạ độ) ở góc dưới trái ảnh, trên nền tối mờ để dễ đọc. */
function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: { address: string; time: string; coords: string }) {
  const size = Math.max(11, Math.round(w * 0.038));
  const pad = Math.round(size * 0.9);
  ctx.font = `600 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const addr = wrapText(ctx, lines.address, w - pad * 2, 2);
  const rows = [...addr, lines.time, lines.coords];
  const lineH = Math.round(size * 1.3);
  const blockH = rows.length * lineH + pad;
  const top = h - blockH - pad * 0.5;
  const grad = ctx.createLinearGradient(0, top - pad, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.35, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, top - pad, w, h - (top - pad));
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = Math.max(2, size * 0.15);
  rows.forEach((row, i) => {
    ctx.fillText(row, pad, top + lineH * (i + 1) - Math.round(size * 0.2));
  });
  ctx.shadowBlur = 0;
}

/** Chụp đóng băng khung hình ngay lúc bấm nút, để việc tra địa chỉ sau đó không làm lệch ảnh. */
function snapshot(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

function compressFrame(source: HTMLCanvasElement, stamp: { address: string; time: string; coords: string } | null): string | null {
  let width = Math.min(720, source.width || 720);
  let quality = 0.72;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement("canvas");
    const ratio = width / source.width;
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (stamp) drawStamp(ctx, canvas.width, canvas.height, stamp);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= PHOTO_MAX) return url;
    quality -= 0.12;
    width = Math.round(width * 0.75);
  }
  return null;
}

export function CameraSheet({
  onShot,
  onClose,
  onDenied,
  stamp,
  lookupAddress,
}: {
  onShot: (photo: string) => void;
  onClose: () => void;
  /** Gọi khi quyền camera bị từ chối, để màn chấm công mở hướng dẫn bật quyền. */
  onDenied?: () => void;
  /** Có thì ghi giờ, địa chỉ và toạ độ lên ảnh. */
  stamp?: PhotoStamp | null;
  /** Tra địa chỉ từ toạ độ; lỗi hoặc chậm thì ảnh chỉ ghi toạ độ. */
  lookupAddress?: (lat: number, lng: number) => Promise<string | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;
  const [error, setError] = useState("");
  const addrRef = useRef<{ value: string | null; promise: Promise<void> } | null>(null);
  const [shooting, setShooting] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // stop previous
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if ((name === "NotAllowedError" || name === "SecurityError") && deniedRef.current) {
          deniedRef.current();
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("Máy không có camera phù hợp. Thử bấm “Camera sau/trước”.");
        } else if (name === "NotReadableError") {
          setError("Camera đang được app khác dùng. Đóng app đó rồi thử lại.");
        } else {
          setError("Không mở được camera. Hãy cho phép quyền camera rồi thử lại.");
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [facing]);

  // Tra địa chỉ ngay khi mở camera để lúc bấm chụp thường đã có sẵn.
  const stampLat = stamp?.lat;
  const stampLng = stamp?.lng;
  useEffect(() => {
    if (stampLat == null || stampLng == null || !lookupAddress) {
      addrRef.current = null;
      return;
    }
    const state: { value: string | null; promise: Promise<void> } = { value: null, promise: Promise.resolve() };
    state.promise = lookupAddress(stampLat, stampLng)
      .then((v) => {
        state.value = v;
      })
      .catch(() => {});
    addrRef.current = state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stampLat, stampLng]);

  async function shoot() {
    const video = videoRef.current;
    if (shooting) return;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng.");
      return;
    }
    setShooting(true);
    setError("");
    const takenAt = new Date();
    const frame = snapshot(video);
    if (!frame) {
      setShooting(false);
      setError("Camera chưa sẵn sàng.");
      return;
    }
    let lines: { address: string; time: string; coords: string } | null = null;
    if (stamp) {
      // Chờ địa chỉ tối đa 2,5 giây; không kịp thì ghi toạ độ, không chặn việc chấm công.
      const pending = addrRef.current;
      if (pending) await Promise.race([pending.promise, new Promise<void>((r) => setTimeout(r, 2500))]);
      const coords = `${stamp.lat.toFixed(5)}, ${stamp.lng.toFixed(5)}`;
      const base = pending?.value ?? "";
      const address = [stamp.placeName, base].filter(Boolean).join(" · ") || `Toạ độ ${coords}`;
      lines = {
        address,
        time: stampTime(takenAt),
        coords: `Kinh độ: ${stamp.lng.toFixed(4)}  Vĩ độ: ${stamp.lat.toFixed(4)}`,
      };
    }
    const photo = compressFrame(frame, lines);
    setShooting(false);
    if (!photo) {
      setError("Ảnh quá nặng. Thử lại ở nơi sáng hơn.");
      return;
    }
    onShot(photo);
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-paper text-ink">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium">Chụp khuôn mặt tại nơi làm việc</p>
        <button type="button" onClick={() => setFacing(f => f === "user" ? "environment" : "user")} className="rounded-full bg-sand px-3 py-2 text-xs font-medium">
          {facing === "user" ? "Camera sau" : "Camera trước"}
        </button>
        <button type="button" className="grid size-11 place-items-center rounded-full bg-sand" onClick={onClose} aria-label="Đóng camera">
          <X className="size-5" />
        </button>
      </div>
      <div className="relative mx-4 flex-1 overflow-hidden rounded-2xl border border-line bg-sand">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      </div>
      {error ? <p className="px-4 pt-3 text-sm text-clay">{error}</p> : null}
      <div className="flex justify-center px-4 py-5">
        <button type="button" onClick={() => void shoot()} disabled={shooting} className="grid size-16 place-items-center rounded-full border-2 border-amber/50 disabled:opacity-50" aria-label="Chụp ảnh">
          <span className="size-12 rounded-full bg-ice" />
        </button>
      </div>
    </div>
  );
}
