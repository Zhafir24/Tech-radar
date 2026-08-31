import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlipDefinition } from "./TechRadar/types";
import { ManageSourcesModal } from "./ManageSourcesModal";

/**
 * How often we re-read /radar-diagnostics.json. Doubles as the tick that
 * refreshes the relative "last run" label, so the widget keeps one timer.
 */
const POLL_INTERVAL_MS = 30_000;

/* ────────────────────────────────────────────────────────────────────────
 * Diagnostics schema — must match writeDiagnostics() output.
 * ──────────────────────────────────────────────────────────────────────── */

export interface Diagnostics {
  generatedAt: string;
  durationMs: number;
  health: "ok" | "warn" | "error";
  sources: Array<{
    id: string;
    displayName: string;
    status: "ok" | "error" | "skipped" | "empty";
    itemCount: number;
    error?: string;
    reason?: string;
  }>;
  sourcesSummary: { ok: number; active: number; total: number };
  pipeline: {
    candidates: number;
    mentions: number;
    technologiesFresh: number;
    technologiesInStore: number;
    selected: number;
  };
  distribution: {
    byQuadrant: Record<string, number>;
    byRing: Record<string, number>;
  };
  changes: {
    hasHistory: boolean;
    added: string[];
    removed: string[];
    movedUp: Array<{ slug: string; from: string; to: string }>;
    movedDown: Array<{ slug: string; from: string; to: string }>;
  };
}

interface PipelineStatusProps {
  /**
   * Called when the parent should re-fetch /radar-data.json — on the Refresh
   * button, and automatically once a scrape run is detected. Returning the
   * promise lets the Refresh spinner stop only when the data has landed.
   */
  onRefresh: () => void | Promise<void>;
  /** Blip slug → display name, for resolving change slugs to human names. */
  blipNames?: Map<string, string>;
}

/**
 * Live status widget for the scraping pipeline.
 *
 * Pulls /radar-diagnostics.json (written by the scraper on each run) and
 * displays:
 *   - a health pill (green / amber / red)
 *   - a relative timestamp that ticks every 30 seconds
 *   - a Refresh button that re-fetches data + diagnostics
 *
 * The same 30-second tick re-reads the diagnostics file, so a scrape that
 * finishes anywhere (terminal or dialog) pulls its new snapshot onto the
 * radar without a page reload.
 *   - an expandable details panel with per-source stats, pipeline totals,
 *     distribution, and the diff vs the previous run
 *
 * The user can quickly answer "is the scraper working?" and "did anything
 * actually change?" without leaving the page.
 */
export function PipelineStatus({ onRefresh, blipNames }: PipelineStatusProps) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [manageOpen, setManageOpen] = useState(false);

  /**
   * `generatedAt` of the run whose data the radar is currently showing.
   * Compared on every diagnostics load to detect that a scrape finished.
   */
  const renderedRunAt = useRef<string | null>(null);

  /**
   * Held in a ref rather than a dependency so `fetchDiagnostics` stays
   * identity-stable: it is in the dependency list of the mount effect and
   * the poll below, and a changing `onRefresh` would restart both.
   */
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const fetchDiagnostics = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/radar-diagnostics.json", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = (await response.json()) as Diagnostics;
      setData(parsed);

      // A finished scrape rewrites radar-data.json and radar-diagnostics.json
      // together, so a moved `generatedAt` is the page's only signal that the
      // snapshot underneath it changed. Pull the new one instead of leaving
      // the previous edition on screen until someone reloads by hand — that
      // covers runs started from a terminal (`npm run scrape`) and runs whose
      // Manage-sources dialog was closed before they finished, neither of
      // which reaches the dialog's own onAfterScrape callback.
      const previousRunAt = renderedRunAt.current;
      renderedRunAt.current = parsed.generatedAt;
      if (previousRunAt !== null && previousRunAt !== parsed.generatedAt) {
        void onRefreshRef.current();
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setData(null);
      return false;
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics();
  }, [fetchDiagnostics]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
      void fetchDiagnostics();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchDiagnostics]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchDiagnostics(), Promise.resolve(onRefresh())]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchDiagnostics, onRefresh]);

  const ageInfo = useMemo(() => computeAge(data?.generatedAt, now), [data, now]);
  const effectiveHealth = useMemo<Diagnostics["health"] | "unknown">(() => {
    if (error) return "error";
    if (!data) return "unknown";
    if (ageInfo.hours > 72) return "error";
    if (ageInfo.hours > 25 && data.health === "ok") return "warn";
    return data.health;
  }, [data, error, ageInfo]);

  const nameFor = useCallback(
    (slug: string) => blipNames?.get(slug) ?? slug,
    [blipNames],
  );

  return (
    <section
      aria-label="Pipeline status"
      className="mx-auto mb-6 mt-4 max-w-[1920px] px-4 sm:px-6"
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-[12.5px] ${
          effectiveHealth === "ok"
            ? "border-emerald-200 bg-emerald-50/70"
            : effectiveHealth === "warn"
              ? "border-amber-200 bg-amber-50/70"
              : effectiveHealth === "error"
                ? "border-red-200 bg-red-50/70"
                : "border-slate-200 bg-slate-50/70"
        }`}
      >
        <HealthDot health={effectiveHealth} />
        <span className="font-semibold text-[#1F2A44]">
          {statusHeadline(effectiveHealth, data, error, ageInfo)}
        </span>

        {data && (
          <>
            <Divider />
            <SourcesInline data={data} />
            <Divider />
            <span className="text-slate-600">
              {data.pipeline.selected} blips · {data.pipeline.candidates} candidates
            </span>
            <Divider />
            <ChangesInline data={data} />
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-semibold text-[#1F2A44] hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshIcon spinning={refreshing} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-semibold text-[#1F2A44] hover:bg-slate-50"
          >
            {expanded ? "Hide details" : "Show details"}
            <Chevron open={expanded} />
          </button>
        </div>
      </div>

      {expanded && (data || error) && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-[12.5px] text-slate-700 shadow-sm">
          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <strong>radar-diagnostics.json unavailable.</strong> {error}. Run{" "}
              <code className="rounded bg-slate-100 px-1">npm run scrape</code> in
              a terminal to generate it.
            </p>
          )}
          {data && (
            <DetailsPanel
              data={data}
              nameFor={nameFor}
              onManage={() => setManageOpen(true)}
            />
          )}
        </div>
      )}

      {manageOpen && (
        <ManageSourcesModal
          onClose={() => setManageOpen(false)}
          onAfterScrape={handleRefresh}
        />
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Details panel — expanded view
 * ──────────────────────────────────────────────────────────────────────── */

function DetailsPanel({
  data,
  nameFor,
  onManage,
}: {
  data: Diagnostics;
  nameFor: (slug: string) => string;
  onManage: () => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <SectionHead>Sources</SectionHead>
        <ul className="mt-2 space-y-1">
          {data.sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-2 tabular-nums"
            >
              <SourceStatusIcon status={source.status} />
              <span className="font-medium">{source.displayName}</span>
              <span className="ml-auto text-slate-500">
                {source.status === "skipped"
                  ? source.reason ?? "skipped"
                  : source.status === "error"
                    ? `error — ${source.error ?? "unknown"}`
                    : source.status === "empty"
                      ? "0 items — check the URL"
                      : `${source.itemCount.toLocaleString()} items`}
              </span>
            </li>
          ))}
        </ul>

        <SectionHead className="mt-5">Pipeline</SectionHead>
        <p className="mt-2 tabular-nums text-slate-600">
          {data.pipeline.candidates.toLocaleString()} candidates →{" "}
          {data.pipeline.mentions.toLocaleString()} mentions →{" "}
          {data.pipeline.technologiesFresh.toLocaleString()} technologies fresh
          this run
        </p>
        <p className="tabular-nums text-slate-600">
          Persistent store: {data.pipeline.technologiesInStore.toLocaleString()} total
        </p>
        <p className="tabular-nums text-slate-600">
          Wrote {data.pipeline.selected.toLocaleString()} blips in{" "}
          {Math.round(data.durationMs / 100) / 10}s
        </p>
      </div>

      <div>
        <SectionHead>Distribution</SectionHead>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
          <div className="col-span-2 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
            By quadrant
          </div>
          {Object.entries(data.distribution.byQuadrant).map(([quadrant, count]) => (
            <div key={quadrant} className="flex justify-between">
              <span>{prettyQuadrant(quadrant)}</span>
              <span className="tabular-nums">{count}</span>
            </div>
          ))}
          <div className="col-span-2 mt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
            By ring
          </div>
          {Object.entries(data.distribution.byRing).map(([ring, count]) => (
            <div key={ring} className="flex justify-between capitalize">
              <span>{ring}</span>
              <span className="tabular-nums">{count}</span>
            </div>
          ))}
        </div>

        <SectionHead className="mt-5">
          Changes vs. previous run
          {!data.changes.hasHistory && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-slate-500">
              first run
            </span>
          )}
        </SectionHead>
        <ChangesDetail data={data} nameFor={nameFor} />

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onManage}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1F2A44] shadow-sm hover:bg-slate-50"
          >
            <SettingsIcon />
            Manage sources
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangesDetail({
  data,
  nameFor,
}: {
  data: Diagnostics;
  nameFor: (slug: string) => string;
}) {
  if (!data.changes.hasHistory) {
    return (
      <p className="mt-2 text-slate-500">
        Nothing to compare against yet — this looks like the first pipeline
        run. Subsequent runs will diff against this one.
      </p>
    );
  }
  const rows: Array<[string, string, string[]]> = [
    ["Added", "text-emerald-600", data.changes.added.map(nameFor)],
    ["Removed", "text-red-600", data.changes.removed.map(nameFor)],
    [
      "Moved up",
      "text-emerald-600",
      data.changes.movedUp.map((m) => `${nameFor(m.slug)} (${m.from} → ${m.to})`),
    ],
    [
      "Moved down",
      "text-red-600",
      data.changes.movedDown.map((m) => `${nameFor(m.slug)} (${m.from} → ${m.to})`),
    ],
  ];
  return (
    <ul className="mt-2 space-y-1.5">
      {rows.map(([label, color, items]) => (
        <li key={label}>
          <span className={`mr-2 font-semibold ${color}`}>{label}</span>
          {items.length === 0 ? (
            <span className="text-slate-400">none</span>
          ) : (
            <span className="text-slate-700">{items.join(", ")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Small presentation helpers
 * ──────────────────────────────────────────────────────────────────────── */

function HealthDot({
  health,
}: {
  health: Diagnostics["health"] | "unknown";
}) {
  const color =
    health === "ok"
      ? "bg-emerald-500"
      : health === "warn"
        ? "bg-amber-500"
        : health === "error"
          ? "bg-red-500"
          : "bg-slate-400";
  const ringColor =
    health === "ok"
      ? "ring-emerald-500/30"
      : health === "warn"
        ? "ring-amber-500/30"
        : health === "error"
          ? "ring-red-500/30"
          : "ring-slate-400/30";
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
    >
      {health === "ok" && (
        <span
          aria-hidden="true"
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
        />
      )}
      <span
        className={`relative inline-block h-2.5 w-2.5 rounded-full ring-4 ${color} ${ringColor}`}
      />
    </span>
  );
}

function SourcesInline({ data }: { data: Diagnostics }) {
  const { ok, active } = data.sourcesSummary;
  return (
    <span className="text-slate-600">
      Sources <strong className="text-[#1F2A44]">{ok}/{active}</strong> healthy
    </span>
  );
}

function ChangesInline({ data }: { data: Diagnostics }) {
  const total =
    data.changes.added.length +
    data.changes.removed.length +
    data.changes.movedUp.length +
    data.changes.movedDown.length;

  if (!data.changes.hasHistory) {
    return <span className="text-slate-500">First run — no baseline yet</span>;
  }
  if (total === 0) {
    return <span className="text-slate-500">No changes since last run</span>;
  }
  return (
    <span className="text-slate-700 tabular-nums">
      <span className="text-emerald-600">+{data.changes.added.length}</span>{" "}
      <span className="text-red-600">−{data.changes.removed.length}</span>{" "}
      <span className="text-emerald-600">↑{data.changes.movedUp.length}</span>{" "}
      <span className="text-red-600">↓{data.changes.movedDown.length}</span>
    </span>
  );
}

function SourceStatusIcon({
  status,
}: {
  status: "ok" | "error" | "skipped" | "empty";
}) {
  if (status === "ok") return <span className="text-emerald-500">✓</span>;
  if (status === "error") return <span className="text-red-500">✗</span>;
  if (status === "empty") return <span className="text-amber-500">!</span>;
  return <span className="text-slate-400">—</span>;
}

function SectionHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 ${className}`}
    >
      {children}
    </h3>
  );
}

function Divider() {
  return <span aria-hidden="true" className="text-slate-300">·</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={spinning ? "animate-spin" : ""}
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

function computeAge(iso: string | undefined, nowMs: number) {
  if (!iso) return { minutes: 0, hours: 0, label: "unknown" };
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return { minutes: 0, hours: 0, label: "unknown" };
  const diffMs = Math.max(0, nowMs - time);
  const minutes = Math.round(diffMs / 60000);
  const hours = diffMs / 3_600_000;
  let label;
  if (minutes < 1) label = "just now";
  else if (minutes < 60) label = `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  else if (hours < 24) {
    const h = Math.round(hours);
    label = `${h} hour${h === 1 ? "" : "s"} ago`;
  } else {
    const d = Math.round(hours / 24);
    label = `${d} day${d === 1 ? "" : "s"} ago`;
  }
  return { minutes, hours, label };
}

function statusHeadline(
  health: Diagnostics["health"] | "unknown",
  data: Diagnostics | null,
  error: string | null,
  ageInfo: { label: string; hours: number },
): string {
  if (error) return "Pipeline data unavailable";
  if (!data) return "Loading pipeline status…";
  if (health === "error") return `Data is ${ageInfo.label} — stale`;
  if (health === "warn") return `Last run ${ageInfo.label} — check details`;
  return `Radar data live · Last run ${ageInfo.label}`;
}

function prettyQuadrant(id: string): string {
  switch (id) {
    case "infrastructure": return "Infrastructure";
    case "ai-automation": return "AI & Automation";
    case "security": return "Security";
    case "data-integration": return "Data & Integration";
    default: return id;
  }
}

/** Utility for parents to build a slug→name map from radar blips. */
export function blipNameMap(
  blips: BlipDefinition[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const blip of blips ?? []) map.set(blip.id, blip.name);
  return map;
}
