import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { coordText, mapEmbedUrl, mapsUrl } from "@/lib/map-link";
import { gpsFlagLabel, isStrongGpsFlag } from "@/lib/attendance-types";

/** Vị trí của một lượt chấm công (lấy cùng lúc với ảnh). */
export type PunchWhere = {
  lat: number | null;
  lng: number | null;
  address: string | null;
  /** Sai số GPS (m) và dấu hiệu bất thường: chỉ có khi người xem là quản trị hoặc người duyệt. */
  accuracy?: number | null;
  flags?: string[];
};

/** Dưới mỗi ảnh chấm công: địa chỉ, nút mở bản đồ và bản đồ nhỏ xem nhanh. Không có toạ độ thì không hiện gì. */
export function PunchMapLink({ where }: { where: PunchWhere | null | undefined }) {
  const [map, setMap] = useState(false);
  if (!where || where.lat == null || where.lng == null) return null;
  const { lat, lng, address } = where;
  const flags = where.flags ?? [];
  const strong = flags.some(isStrongGpsFlag);
  return (
    <div className="mt-2 space-y-2">
      {flags.length ? (
        <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${strong ? "border-clay bg-[#fbe9e4] text-ink" : "border-amber bg-[#fff6dd] text-ink"}`}>
          <p className="font-semibold">{strong ? "Nghi ngờ giả GPS" : "Lưu ý về GPS"}</p>
          <ul className="mt-0.5 list-disc pl-4">
            {flags.map((f) => (
              <li key={f}>{gpsFlagLabel(f)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="flex items-start gap-2 text-xs leading-5">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-clay" />
        <span>
          {address ?? "Chưa tra được địa chỉ"}
          <span className="block text-muted tabular-nums">
            {coordText(lat, lng)}
            {where.accuracy != null ? ` · sai số GPS ~${where.accuracy} m` : ""}
          </span>
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
