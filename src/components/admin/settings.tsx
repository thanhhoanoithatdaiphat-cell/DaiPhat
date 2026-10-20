import { LocationEditor, SettingsForm } from "@/components/panels";
import type { AdminCtx } from "./app";
import { PageHero } from "./common";
import { HolidayCard } from "./holidays";

export function SettingsView({ ctx }: { ctx: AdminCtx }) {
  const { data, reload } = ctx;
  return (
    <div className="space-y-6">
      <PageHero title="Cài đặt" subtitle="Ca làm, công chuẩn, hệ số Chủ nhật và lễ, điểm chấm công, ngày lễ" />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <SettingsForm data={data} onChanged={reload} />
        <div className="space-y-6">
          <LocationEditor locations={data.locations} onChanged={reload} />
          <HolidayCard onChanged={reload} />
        </div>
      </div>
    </div>
  );
}
