import { LocationEditor, PeopleEditor, SettingsForm } from "@/components/panels";
import { InviteCodeCard } from "@/components/invite-card";
import type { AdminCtx } from "./app";

export function SettingsView({ ctx }: { ctx: AdminCtx }) {
  const { data, reload } = ctx;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-semibold">Cài đặt</h1>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <InviteCodeCard />
          <SettingsForm data={data} onChanged={reload} />
          <LocationEditor locations={data.locations} onChanged={reload} />
        </div>
        <PeopleEditor people={data.teamToday} selfId={data.profile.userId} onChanged={reload} />
      </div>
    </div>
  );
}
