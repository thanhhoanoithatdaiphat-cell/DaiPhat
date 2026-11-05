import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/** Giữ ảnh chấm công bao nhiêu ngày. Sau đó chỉ xóa ảnh, vẫn giữ giờ và vị trí. */
const PHOTO_RETENTION_DAYS = 60;

/**
 * Tác vụ dọn dẹp chạy hằng ngày bằng Vercel Cron (xem vercel.json).
 * Vercel tự gửi `Authorization: Bearer $CRON_SECRET` nếu bạn đặt biến CRON_SECRET.
 */
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && !secret) {
    return Response.json({ error: "Thiếu CRON_SECRET" }, { status: 503 });
  }
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Không có quyền" }, { status: 401 });
  }
  const sql = await getSql();
  const cleared = await sql<{ id: number }>`
    update attendances set photo_data = null
    where photo_data is not null
      and punched_at < now() - make_interval(days => ${PHOTO_RETENTION_DAYS})
    returning id
  `;
  // Địa chỉ đệm cũ hơn 180 ngày cho tra lại (tên đường có thể đổi); lỗi ở bước này không làm hỏng việc dọn ảnh.
  const geo = await sql<{ cell: string }>`delete from geocode_cache where created_at < now() - interval '180 days' returning cell`.catch(() => [] as { cell: string }[]);
  return Response.json({ ok: true, photosRemoved: cleared.length, olderThanDays: PHOTO_RETENTION_DAYS, geocodeRemoved: geo.length });
}

export const Route = createFileRoute("/api/cron/cleanup")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
    },
  },
});
