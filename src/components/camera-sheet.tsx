import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const PHOTO_MAX = 180_000;

function compressFrame(video: HTMLVideoElement): string | null {
  let width = Math.min(720, video.videoWidth || 720);
  let quality = 0.72;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || width;
    const sourceHeight = video.videoHeight || Math.round(width * 1.25);
    const ratio = width / sourceWidth;
    canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
    canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
}: {
  onShot: (photo: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
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
      } catch {
        if (!cancelled) setError("Không mở được camera. Hãy cho phép quyền camera rồi thử lại.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [facing]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng.");
      return;
    }
    const photo = compressFrame(video);
    if (!photo) {
      setError("Ảnh quá nặng. Thử lại ở nơi sáng hơn.");
      return;
    }
    onShot(photo);
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ink text-card">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium">Chụp khuôn mặt tại nơi làm việc</p>
        <button type="button" onClick={() => setFacing(f => f === "user" ? "environment" : "user")} className="rounded-full bg-card/10 px-3 py-2 text-xs font-medium">
          {facing === "user" ? "Camera sau" : "Camera trước"}
        </button>
        <button type="button" className="grid size-11 place-items-center rounded-full bg-card/10" onClick={onClose} aria-label="Đóng camera">
          <X className="size-5" />
        </button>
      </div>
      <div className="relative mx-4 flex-1 overflow-hidden rounded-2xl bg-pine-deep">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      </div>
      {error ? <p className="px-4 pt-3 text-sm text-sand">{error}</p> : null}
      <div className="flex justify-center px-4 py-5">
        <button type="button" onClick={shoot} className="grid size-16 place-items-center rounded-full border border-card/40" aria-label="Chụp ảnh">
          <span className="size-12 rounded-full bg-card" />
        </button>
      </div>
    </div>
  );
}
