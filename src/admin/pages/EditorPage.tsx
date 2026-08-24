import { useMemo, useState } from "react";
import { TechRadar } from "../../components/TechRadar/TechRadar";
import { resolveBlips } from "../../components/TechRadar/radarConfig";
import type {
  BlipDefinition,
  MovementStatus,
  QuadrantId,
  RingId,
} from "../../components/TechRadar/types";
import { useAdmin } from "../store";
import {
  Button,
  Card,
  EmptyState,
  Field,
  INPUT_CLASS,
  Modal,
  MovementGlyph,
  MOVEMENT_LABELS,
  Segmented,
  Toggle,
} from "../ui";

/**
 * Radar Editor: live radar preview (the real TechRadar component, rendering
 * the DRAFT config) on the left, a property inspector for the selected blip
 * on the right. Selection is bidirectional — clicking a blip on the radar
 * opens it in the inspector, and every inspector edit re-renders the radar
 * instantly because both read the same draft state.
 */
export function EditorPage() {
  const {
    state,
    select,
    patchBlip,
    duplicateBlip,
    deleteBlips,
  } = useAdmin();
  const { config, meta } = state.snapshot;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolved = useMemo(() => resolveBlips(config), [config]);
  const blip = state.selectedId
    ? (config.blips.find((b) => b.id === state.selectedId) ?? null)
    : null;
  const resolvedBlip = state.selectedId
    ? (resolved.find((b) => b.id === state.selectedId) ?? null)
    : null;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card
        title="Live preview"
        subtitle="This is the draft radar — click a blip to edit it. Publish to make changes live."
      >
        <TechRadar
          config={config}
          title={meta.title}
          version={meta.version}
          showLegends={false}
          selectedId={state.selectedId}
          onSelectBlip={select}
        />
      </Card>

      {!blip || !resolvedBlip ? (
        <Card>
          <EmptyState
            icon="radar"
            title="No blip selected"
            body="Click any blip on the radar preview, or use the Items table, to edit its properties here."
          />
        </Card>
      ) : (
        <Inspector
          key={blip.id}
          blip={blip}
          resolvedAngle={resolvedBlip.angle}
          resolvedRadius={resolvedBlip.radiusFraction}
          onPatch={(patch) => patchBlip(blip.id, patch)}
          onDuplicate={() => duplicateBlip(blip.id)}
          onDelete={() => setConfirmDelete(true)}
        />
      )}

      {confirmDelete && blip && (
        <Modal
          title="Delete item?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  deleteBlips([blip.id]);
                  setConfirmDelete(false);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          "{blip.name}" will be removed from the draft radar.
        </Modal>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

interface InspectorProps {
  blip: BlipDefinition;
  resolvedAngle: number;
  resolvedRadius: number;
  onPatch: (patch: Partial<BlipDefinition>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function Inspector({
  blip,
  resolvedAngle,
  resolvedRadius,
  onPatch,
  onDuplicate,
  onDelete,
}: InspectorProps) {
  const { state } = useAdmin();
  const { config } = state.snapshot;

  const isManual = blip.angle !== undefined && blip.radiusFraction !== undefined;

  /* Slider bounds: the blip's quadrant sector and ring band. */
  const quadrant = config.quadrants.find((q) => q.id === blip.quadrant)!;
  const sortedRings = [...config.rings].sort((a, b) => a.radius - b.radius);
  const ringIndex = sortedRings.findIndex((r) => r.id === blip.ring);
  const innerRadius = ringIndex <= 0 ? 0 : sortedRings[ringIndex - 1].radius;
  const margin = config.scatter.radiusMargin * config.outerRadius;
  const minFrac =
    (ringIndex <= 0 ? 12 : innerRadius + margin) / config.outerRadius;
  const maxFrac = (sortedRings[ringIndex].radius - margin) / config.outerRadius;
  const minAngle = quadrant.angleRange.min + config.scatter.angleMargin;
  const maxAngle = quadrant.angleRange.max - config.scatter.angleMargin;

  const statusOptions: MovementStatus[] = [
    "no-change",
    "moved-up",
    "moved-down",
    "new",
  ];

  return (
    <Card
      title={`#${blip.number} · Inspector`}
      subtitle="Changes apply to the draft instantly"
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            value={blip.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Ring">
          <Segmented
            ariaLabel="Ring assignment"
            value={blip.ring}
            onChange={(ring: RingId) => onPatch({ ring })}
            options={config.rings.map((ring) => ({
              value: ring.id,
              label: (
                <>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: ring.colors.blip }}
                  />
                  {ring.label.charAt(0) + ring.label.slice(1).toLowerCase()}
                </>
              ),
            }))}
          />
        </Field>

        <Field label="Quadrant" hint="Changing ring or quadrant re-places the blip automatically.">
          <select
            value={blip.quadrant}
            onChange={(e) => onPatch({ quadrant: e.target.value as QuadrantId })}
            className={INPUT_CLASS}
          >
            {config.quadrants.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Movement">
          <Segmented
            ariaLabel="Movement status"
            value={blip.status}
            onChange={(status: MovementStatus) => onPatch({ status })}
            options={statusOptions.map((status) => ({
              value: status,
              label: (
                <>
                  <MovementGlyph status={status} size={13} />
                  {MOVEMENT_LABELS[status]}
                </>
              ),
            }))}
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-[#E7EAF0] px-3 py-2.5">
          <div>
            <p className="text-[13px] font-semibold">Visible on radar</p>
            <p className="text-[11px] text-slate-400">
              Hidden items stay in the dataset
            </p>
          </div>
          <Toggle
            checked={!blip.hidden}
            onChange={(visible) => onPatch({ hidden: !visible })}
            label="Toggle radar visibility"
          />
        </div>

        <Field label="Description">
          <textarea
            value={blip.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={3}
            placeholder="Shown in the blip tooltip"
            className={`${INPUT_CLASS} resize-y`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Since version">
            <input
              value={blip.since ?? ""}
              onChange={(e) => onPatch({ since: e.target.value })}
              placeholder="e.g. 2025.11"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Owner">
            <input
              value={blip.owner ?? ""}
              onChange={(e) => onPatch({ owner: e.target.value })}
              placeholder="Team / person"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        {/* Position */}
        <div className="rounded-lg border border-[#E7EAF0] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
              Position
            </p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
              {isManual ? "Manual" : "Auto (scatter)"}
            </span>
          </div>
          <p className="mb-2 text-[12px] tabular-nums text-slate-500">
            angle {resolvedAngle.toFixed(1)}° · radius{" "}
            {(resolvedRadius * 100).toFixed(1)}% of outer
          </p>
          {isManual ? (
            <div className="space-y-3">
              <label className="block text-[12px]">
                <span className="mb-1 flex justify-between text-slate-500">
                  <span>Angle</span>
                  <span className="tabular-nums">{blip.angle!.toFixed(1)}°</span>
                </span>
                <input
                  type="range"
                  min={minAngle}
                  max={maxAngle}
                  step={0.5}
                  value={blip.angle}
                  onChange={(e) =>
                    onPatch({ angle: Number(e.target.value) })
                  }
                  className="w-full accent-[#1D4ED8]"
                  aria-label="Blip angle"
                />
              </label>
              <label className="block text-[12px]">
                <span className="mb-1 flex justify-between text-slate-500">
                  <span>Radius</span>
                  <span className="tabular-nums">
                    {(blip.radiusFraction! * 100).toFixed(1)}%
                  </span>
                </span>
                <input
                  type="range"
                  min={minFrac}
                  max={maxFrac}
                  step={0.005}
                  value={blip.radiusFraction}
                  onChange={(e) =>
                    onPatch({ radiusFraction: Number(e.target.value) })
                  }
                  className="w-full accent-[#1D4ED8]"
                  aria-label="Blip radius"
                />
              </label>
              <Button
                onClick={() =>
                  onPatch({ angle: undefined, radiusFraction: undefined })
                }
              >
                Reset to auto placement
              </Button>
            </div>
          ) : (
            <Button
              onClick={() =>
                onPatch({
                  angle: Number(resolvedAngle.toFixed(1)),
                  radiusFraction: Number(resolvedRadius.toFixed(4)),
                })
              }
            >
              Set manual position
            </Button>
          )}
        </div>

        <div className="flex gap-2 border-t border-[#F0F2F6] pt-4">
          <Button icon="copy" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="danger" icon="trash" className="ml-auto" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
