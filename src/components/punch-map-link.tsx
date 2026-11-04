import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { coordText, mapEmbedUrl, mapsUrl } from "@/lib/map-link";

/** Vị trí của một lượt chấm công (lấy cùng lúc với ảnh). */
export type PunchWhere = { lat: number | null; lng: number | null; address: string | null };

/** Dưới mỗi ảnh chấm công: địa chỉ, nút mở bản đồ và bản đồ nhỏ xem nhanh. Không có toạ độ thì không hiện gì. */
export function PunchMapLink({ where }: { where: PunchWhere | null | undefined }) {
  const [map, setMap] = useState(false);
  if (!where || where.lat == null || where.lng == null) return null;
  const { lat, lng, address } = where;
  return (
    <div className="mt-2 space-y-2">
      <p className="flex items-start gap-2 text-xs leading-5">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-clay" />
        <span>
          {address ?? "Chưa tra được địa chỉ"}
          <span className="block text-muted tabular-nums">{coordText(lat, lng)}</span>
        </span>
      </p>
      <div className="flex gap-2 text-xs font-semibold">
        <a href={mapsUrl(lat, lng)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md bg-night px-3 text-ice">
          Mở bản đồ <ExternalLink className="size-3" />
        </a>
        <button type="button" className="inline-flex h-8 items-center rounded-md border border-line px-3" onClick={() => setMap((v) => !v)}>
          {map ? "Ẩn bản đồ" : "Xem nhanh"}
        </button>
      </div>
      {map ? <iframe title="Vị trí chấm công" src={mapEmbedUrl(lat, lng)} className="h-44 w-full rounded-lg border border-line" loading="lazy" /> : null}
    </div>
  );
}
