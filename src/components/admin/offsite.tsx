import { useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin, X } from "lucide-react";
import type { PersonRow, PunchRow } from "@/lib/attendance-types";
import { vnTime } from "@/lib/vn-time";
import { coordText, mapEmbedUrl, mapsUrl } from "@/lib/map-link";
import { compareByCode } from "@/lib/employee-order";
import { PunchPhoto, useClickAway } from "./common";

type Group = { userId: string; fullName: string; code: string | null; dept: string | null; punches: PunchRow[] };

/** Gom các lượt chấm ngoài điểm hôm nay theo từng người (mỗi người một thẻ, các lượt xếp theo giờ). */
export function groupOffsite(rows: PunchRow[], people: PersonRow[]): Group[] {
  const byId = new Map(people.map((p) => [p.userId, p]));
  const map = new Map<string, Group>();
  for (const r of rows) {
    const id = r.userId ?? "";
    const p = byId.get(id);
    const g = map.get(id) ?? { userId: id, fullName: p?.fullName ?? r.fullName ?? "Nhân viên", code: p?.employeeCode ?? null, dept: p?.department ?? null, punches: [] };
    g.punches.push(r);
    map.set(id, g);
  }
  const out = [...map.values()];
  out.forEach((g) => g.punches.sort((a, b) => a.punchedAt.localeCompare(b.punchedAt)));
  return out.sort((a, b) => compareByCode({ employeeCode: a.code, fullName: a.fullName }, { employeeCode: b.code, fullName: b.fullName }));
}

/** Vị trí người chấm: địa chỉ, link mở bản đồ và bản đồ nhỏ bấm để xem. */
function Where({ row }: { row: PunchRow }) {
  const [map, setMap] = useState(false);
  if (row.lat == null || row.lng == null) {
    return <p className="text-xs text-muted">Không có toạ độ cho lượt này.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm leading-5">
        <MapPin className="mt-0.5 size-4 shrink-0 text-clay" />
        <span>
          {row.address ?? "Chưa tra được địa chỉ"}
          <span className="block text-xs text-muted tabular-nums">{coordText(row.lat, row.lng)}</span>
        </span>
      </p>
      <div className="flex gap-2 text-xs font-semibold">
        <a href={mapsUrl(row.lat, row.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md bg-night px-3 text-ice">
          Mở bản đồ <ExternalLink className="size-3" />
        </a>
        <button type="button" className="inline-flex h-8 items-center rounded-md border border-line px-3" onClick={() => setMap((v) => !v)}>
          {map ? "Ẩn bản đồ" : "Xem nhanh"}
        </button>
      </div>
      {map ? <iframe title="Vị trí chấm công" src={mapEmbedUrl(row.lat, row.lng)} className="h-44 w-full rounded-lg border border-line" loading="lazy" /> : null}
    </div>
  );
}

export function OffsiteDrawer({ groups, allowOffsite, onClose }: { groups: Group[]; allowOffsite: boolean; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useClickAway(ref, onClose, true);
  const punchCount = useMemo(() => groups.reduce((n, g) => n + g.punches.length, 0), [groups]);
  return (
    <aside ref={ref} className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l-2 border-ink bg-paper shadow-2xl sm:w-[26rem]" aria-label="Chấm ngoài điểm hôm nay">
      <header className="flex items-start justify-between gap-3 bg-night px-5 py-4 text-[#fff3d6]">
        <div>
          <h2 className="font-display text-3xl leading-tight font-bold">Chấm ngoài điểm</h2>
          <p className="mt-0.5 text-xs text-ice">
            Hôm nay · {groups.length} người · {punchCount} lượt
          </p>
        </div>
        <button type="button" aria-label="Đóng" className="grid size-9 shrink-0 place-items-center rounded-md bg-[#433427]" onClick={onClose}>
          <X className="size-5" />
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {groups.length === 0 ? (
          <div className="rounded-xl border border-line bg-card px-5 py-10 text-center">
            <MapPin className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-semibold">Hôm nay chưa có ai chấm ngoài điểm</p>
            <p className="mt-1 text-sm text-muted">
              {allowOffsite ? "Khi có người chấm xa điểm làm việc, từng lượt sẽ hiện ở đây kèm ảnh." : "Công ty đang tắt chấm ngoài điểm."}
            </p>
          </div>
        ) : null}
        {groups.map((g) => (
          <article key={g.userId} className="overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sand font-display text-xl font-semibold">{g.fullName.charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{g.fullName}</p>
                <p className="truncate text-xs text-muted">{[g.code, g.dept].filter(Boolean).join(" · ") || "Chưa có mã NV, phòng ban"}</p>
              </div>
              <span className="rounded-md bg-clay px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white">{g.punches.length} lượt</span>
            </div>
            <ul className="divide-y divide-line">
              {g.punches.map((r) => (
                <li key={r.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-12 rounded-md py-0.5 text-center text-xs font-semibold ${r.type === "in" ? "bg-[#d5f2e3] text-[#1f6a49]" : "bg-sand text-ink"}`}>{r.type === "in" ? "Vào" : "Ra"}</span>
                    <p className="font-display text-2xl leading-none font-semibold tabular-nums">{vnTime(r.punchedAt)}</p>
                  </div>
                  <Where row={r} />
                  {r.hasPhoto ? <PunchPhoto id={r.id} /> : <p className="text-xs text-muted">Không có ảnh</p>}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </aside>
  );
}
