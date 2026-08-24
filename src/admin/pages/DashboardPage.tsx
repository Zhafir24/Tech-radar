import { useMemo } from "react";
import { TechRadar } from "../../components/TechRadar/TechRadar";
import { useAdmin } from "../store";
import { Button, Card, Icon, fmtDateTime, type IconName } from "../ui";

export function DashboardPage() {
  const { state, unpublished, navigate } = useAdmin();
  const { config, meta } = state.snapshot;

  const hiddenCount = config.blips.filter((b) => b.hidden).length;
  const lastEdit = useMemo(() => {
    const stamps = config.blips
      .map((b) => b.updatedAt ?? "")
      .filter(Boolean)
      .sort();
    return stamps.at(-1) ?? null;
  }, [config.blips]);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="radar"
          label="Total items"
          value={String(config.blips.length)}
          note={`${config.quadrants.length} quadrants · ${config.rings.length} rings`}
        />
        <StatCard
          icon="eye-off"
          label="Hidden items"
          value={String(hiddenCount)}
          note={hiddenCount === 0 ? "Everything is visible" : "Not rendered on the radar"}
        />
        <StatCard
          icon="check"
          label="Publish state"
          value={unpublished ? "Draft" : "Published"}
          note={
            meta.publishedAt
              ? `Last published ${fmtDateTime(meta.publishedAt)}`
              : "Never published"
          }
          accent={unpublished ? "amber" : "green"}
        />
        <StatCard
          icon="pencil"
          label="Last edit"
          value={lastEdit ? fmtDateTime(lastEdit) : "—"}
          note="Draft autosaves locally"
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
        {/* Live preview */}
        <Card
          title="Live preview (draft)"
          actions={
            <Button variant="primary" icon="radar" onClick={() => navigate("editor")}>
              Open editor
            </Button>
          }
        >
          <div inert className="select-none">
            <TechRadar
              config={config}
              showLegends={false}
              showHeader={false}
            />
          </div>
        </Card>

        {/* Distribution */}
        <div className="space-y-6">
          <Card title="Items per ring">
            <ul className="space-y-2 text-[13px]">
              {config.rings.map((ring) => {
                const count = config.blips.filter((b) => b.ring === ring.id).length;
                return (
                  <li key={ring.id} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ring.colors.blip }}
                    />
                    <span className="font-semibold">{ring.label}</span>
                    <span className="ml-auto tabular-nums text-slate-500">{count}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Items per quadrant">
            <ul className="space-y-2 text-[13px]">
              {config.quadrants.map((quadrant) => {
                const count = config.blips.filter(
                  (b) => b.quadrant === quadrant.id,
                ).length;
                return (
                  <li key={quadrant.id} className="flex items-center gap-2">
                    <span className="font-semibold">{quadrant.label}</span>
                    <span className="ml-auto tabular-nums text-slate-500">{count}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  accent,
}: {
  icon: IconName;
  label: string;
  value: string;
  note: string;
  accent?: "amber" | "green";
}) {
  return (
    <div className="rounded-xl border border-[#E7EAF0] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon name={icon} size={15} />
        <p className="text-[11px] font-bold uppercase tracking-[0.06em]">{label}</p>
      </div>
      <p
        className={`mt-2 text-2xl font-bold ${
          accent === "amber"
            ? "text-amber-600"
            : accent === "green"
              ? "text-emerald-600"
              : "text-[#1F2A44]"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}
