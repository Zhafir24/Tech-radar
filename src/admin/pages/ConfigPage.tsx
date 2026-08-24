import { useRef, useState } from "react";
import { CategoryIcon } from "../../components/TechRadar/CategoryIcon";
import { useAdmin } from "../store";
import {
  Button,
  Card,
  Field,
  INPUT_CLASS,
  Modal,
  Segmented,
  fmtDateTime,
} from "../ui";

type ConfigTab = "general" | "rings" | "quadrants" | "publish";

export function ConfigPage() {
  const {
    state,
    unpublished,
    patchMeta,
    patchRing,
    patchQuadrant,
    patchBlipRadius,
    publish,
    discard,
    resetToDefaults,
    exportJson,
    exportCsv,
    importJsonFile,
  } = useAdmin();
  const { config, meta } = state.snapshot;
  const [tab, setTab] = useState<ConfigTab>("general");
  const [confirmReset, setConfirmReset] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Segmented<ConfigTab>
        ariaLabel="Configuration sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "general", label: "General" },
          { value: "rings", label: "Rings" },
          { value: "quadrants", label: "Quadrants" },
          { value: "publish", label: "Publish & Data" },
        ]}
      />

      {tab === "general" && (
        <Card
          title="General"
          subtitle="Title and version are shown on the public radar header"
        >
          <div className="space-y-4">
            <Field label="Radar title">
              <input
                value={meta.title}
                onChange={(e) => patchMeta({ title: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Version / edition">
              <input
                value={meta.version}
                onChange={(e) => patchMeta({ version: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label={`Blip size — ${config.blipStyle.radius.toFixed(1)}`}
              hint="Applies to every blip on the radar"
            >
              <input
                type="range"
                min={12}
                max={18}
                step={0.5}
                value={config.blipStyle.radius}
                onChange={(e) => patchBlipRadius(Number(e.target.value))}
                className="w-full accent-[#1D4ED8]"
                aria-label="Blip size"
              />
            </Field>
          </div>
        </Card>
      )}

      {tab === "rings" && (
        <Card
          title="Rings"
          subtitle="Labels and colors update the rings, watermarks, blips and legends together"
        >
          <ul className="divide-y divide-[#F0F2F6]">
            {config.rings.map((ring) => {
              const count = config.blips.filter((b) => b.ring === ring.id).length;
              return (
                <li key={ring.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: ring.colors.blip }}
                    aria-hidden="true"
                  />
                  <input
                    value={ring.label}
                    onChange={(e) => patchRing(ring.id, { label: e.target.value })}
                    aria-label={`Label for ${ring.id} ring`}
                    className={`${INPUT_CLASS} w-40`}
                  />
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    Primary
                    <input
                      type="color"
                      value={ring.colors.blip}
                      onChange={(e) => patchRing(ring.id, { primary: e.target.value })}
                      aria-label={`Primary color for ${ring.label}`}
                      className="h-7 w-9 cursor-pointer rounded border border-[#E7EAF0]"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    Stroke
                    <input
                      type="color"
                      value={ring.colors.ring}
                      onChange={(e) => patchRing(ring.id, { stroke: e.target.value })}
                      aria-label={`Stroke color for ${ring.label}`}
                      className="h-7 w-9 cursor-pointer rounded border border-[#E7EAF0]"
                    />
                  </label>
                  <span className="ml-auto text-[12px] text-slate-400">
                    {count} items · r={ring.radius}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-slate-400">
            Ring order and radii are fixed by the maturity model (innermost =
            most mature). Reordering rings would change the meaning of every
            item, so it is intentionally not exposed here.
          </p>
        </Card>
      )}

      {tab === "quadrants" && (
        <Card
          title="Quadrants"
          subtitle="Names update the radar legends and every item's quadrant badge"
        >
          <ul className="divide-y divide-[#F0F2F6]">
            {config.quadrants.map((quadrant) => {
              const count = config.blips.filter(
                (b) => b.quadrant === quadrant.id,
              ).length;
              return (
                <li key={quadrant.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#EDF0F5] bg-white shadow-sm">
                    <svg
                      width={18}
                      height={18}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1F2A44"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <CategoryIcon.Glyph icon={quadrant.icon} />
                    </svg>
                  </span>
                  <input
                    value={quadrant.label}
                    onChange={(e) => patchQuadrant(quadrant.id, e.target.value)}
                    aria-label={`Label for ${quadrant.id} quadrant`}
                    className={`${INPUT_CLASS} w-52`}
                  />
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-500">
                    {quadrant.angleRange.min}°–{quadrant.angleRange.max}°
                  </span>
                  <span className="ml-auto text-[12px] text-slate-400">
                    {count} items
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === "publish" && (
        <>
          <Card title="Publish state" subtitle="The public radar renders the last published snapshot">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                  unpublished
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {unpublished ? "Unpublished changes" : "Up to date"}
              </span>
              <span className="text-[13px] text-slate-500">
                {meta.publishedAt
                  ? `Last published ${fmtDateTime(meta.publishedAt)}`
                  : "Never published"}
              </span>
              <div className="ml-auto flex gap-2">
                <Button onClick={discard} disabled={!unpublished}>
                  Discard draft
                </Button>
                <Button variant="primary" icon="check" onClick={publish}>
                  Publish now
                </Button>
              </div>
            </div>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1D4ED8] hover:underline"
            >
              Open public radar
            </a>
          </Card>

          <Card title="Export / Import" subtitle="Move the radar dataset between environments">
            <div className="flex flex-wrap gap-2">
              <Button icon="download" onClick={exportJson}>
                Export JSON
              </Button>
              <Button icon="download" onClick={exportCsv}>
                Export items CSV
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importJsonFile(file);
                  e.target.value = "";
                }}
              />
              <Button icon="upload" onClick={() => importRef.current?.click()}>
                Import JSON
              </Button>
            </div>
          </Card>

          <Card title="Danger zone">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-slate-500">
                Reset the draft <em>and</em> the published radar to the built-in
                defaults.
              </p>
              <Button
                variant="danger"
                icon="warning"
                className="ml-auto"
                onClick={() => setConfirmReset(true)}
              >
                Reset to defaults
              </Button>
            </div>
          </Card>
        </>
      )}

      {confirmReset && (
        <Modal
          title="Reset everything?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                variant="danger"
                icon="warning"
                onClick={() => {
                  resetToDefaults();
                  setConfirmReset(false);
                }}
              >
                Reset radar
              </Button>
            </>
          }
        >
          This clears the draft and the published snapshot and restores the
          built-in dataset. Export a JSON backup first if you might need the
          current state again.
        </Modal>
      )}
    </div>
  );
}
