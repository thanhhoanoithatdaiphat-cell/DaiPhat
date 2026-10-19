import { LocationEditor, SettingsForm } from "@/components/panels";
import type { AdminCtx } from "./app";
import { HolidayCard } from "./holidays";

export function SettingsView({ ctx }: { ctx: AdminCtx }) {
  const { data, reload } = ctx;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-semibold">Cài đặt</h1>
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
