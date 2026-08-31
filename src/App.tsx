import { useCallback, useEffect, useMemo, useState } from "react";
import { TechRadar } from "./components/TechRadar";
import { PipelineStatus, blipNameMap } from "./components/PipelineStatus";
import type { RadarSnapshot } from "./components/TechRadar/types";
import { DEFAULT_RADAR_CONFIG } from "./components/TechRadar/radarConfig";

/**
 * Cache key for the last successful /radar-data.json fetch. Loaded
 * synchronously on mount so the first paint already has real scraped data
 * instead of briefly flashing the compiled-in DEFAULT_RADAR_CONFIG before
 * the async fetch resolves.
 *
 * The cache is a *placeholder for the first few hundred milliseconds only*.
 * It is never allowed to outlive the fetch: whatever /radar-data.json
 * returns replaces it, and if the fetch cannot replace it the user is told
 * the radar is stale (see the banner below). Without that rule the cache
 * silently pinned the UI to an old edition — sources added after the cache
 * was written never appeared, no matter how many times the scraper ran.
 */
const SCRAPED_CACHE_KEY = "pnm-radar-scraped-cache";

/**
 * Shape check shared by the cache reader and the fetch handler, so a payload
 * that would crash TechRadar (missing blips/rings/quadrants) is rejected in
 * exactly one place rather than drifting between the two call sites.
 */
function isUsableSnapshot(value: unknown): value is RadarSnapshot {
  const snapshot = value as RadarSnapshot | null;
  return (
    !!snapshot &&
    Array.isArray(snapshot.config?.blips) &&
    Array.isArray(snapshot.config?.rings) &&
    Array.isArray(snapshot.config?.quadrants)
  );
}

function loadScrapedCache(): RadarSnapshot | null {
  try {
    const raw = localStorage.getItem(SCRAPED_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isUsableSnapshot(parsed)) return parsed;
  } catch {
    // Corrupted cache — ignore.
  }
  return null;
}

function saveScrapedCache(snapshot: RadarSnapshot): void {
  try {
    localStorage.setItem(SCRAPED_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded / storage disabled — non-fatal.
  }
}

/**
 * Where the snapshot currently on screen came from. `"cache"` means we are
 * still showing the localStorage placeholder and the network has not yet
 * confirmed it, which is the only state in which the radar can be lying
 * about how current it is.
 */
type SnapshotOrigin = "cache" | "network";

interface SnapshotState {
  snapshot: RadarSnapshot;
  origin: SnapshotOrigin;
}

function initialSnapshotState(): SnapshotState | null {
  const cached = loadScrapedCache();
  return cached ? { snapshot: cached, origin: "cache" } : null;
}

/** Renders `publishedAt` for the staleness banner; the field may be null. */
function formatPublishedAt(iso: string | null | undefined): string {
  if (!iso) return "an unknown date";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "an unknown date";
  return new Date(time).toLocaleString();
}

/**
 * Public radar. Data source resolution, in priority order:
 *   1. /radar-data.json served by Vite (scraper output)
 *   2. localStorage cache of the previous fetch (first-paint placeholder only)
 *   3. Compiled-in DEFAULT_RADAR_CONFIG (offline fallback)
 *
 * The scraper is the single source of truth: what it writes is what the
 * radar shows. Add or toggle sources and trigger a run from the
 * PipelineStatus widget above the radar, which also surfaces per-source
 * stats and the change diff so it's obvious whether the pipeline actually
 * ran and whether anything moved since the last edition.
 */
export default function App() {
  // Seed from localStorage cache so the first paint already has real data
  // instead of flashing the compiled-in defaults. Tagged `"cache"` so a
  // failed fetch can say "this is old" instead of passing it off as live.
  const [state, setState] = useState<SnapshotState | null>(initialSnapshotState);
  const [scrapedError, setScrapedError] = useState<string | null>(null);

  const fetchScraped = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/radar-data.json", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!isUsableSnapshot(data)) {
        // A 200 carrying an unusable body used to fall out of this function
        // without setting state *or* an error, so the stale cache stayed on
        // screen forever with nothing to indicate the fetch had failed.
        // Route it through the same error path as a network failure.
        throw new Error("radar-data.json is missing blips/rings/quadrants");
      }
      // The file on disk always wins, even when it carries the same
      // publishedAt as the cache: the scraper rewrites blips, source lines
      // and mention counts on every run, so "same edition" is not the same
      // thing as "same content".
      setState({ snapshot: data, origin: "network" });
      setScrapedError(null);
      saveScrapedCache(data);
    } catch (err) {
      // An abort is our own doing (unmount / a newer fetch superseding this
      // one), not a data problem, so it must not raise the banner.
      if (signal?.aborted) return;
      const name = (err as { name?: unknown } | null | undefined)?.name;
      if (name === "AbortError") return;
      // Everything else has to surface. The previous `err instanceof Error`
      // guard silently dropped any rejection that wasn't an Error of this
      // realm — a thrown string, or one crossing an iframe/worker boundary —
      // which put us straight back to stale data with no warning.
      setScrapedError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchScraped(controller.signal);
    return () => controller.abort();
  }, [fetchScraped]);

  const source = state?.snapshot ?? null;
  const config = source?.config ?? DEFAULT_RADAR_CONFIG;
  const title = source?.meta.title ?? "Tech Radar";
  const version = source?.meta.version ?? "2026.05";
  const updatedAt = source?.meta.publishedAt ?? null;

  const names = useMemo(() => blipNameMap(config.blips), [config.blips]);

  // The old banner was gated on `!source`, which suppressed it in exactly the
  // case that matters: a cached snapshot makes `source` truthy, so a failing
  // fetch rendered old data with no warning at all. Every failure is now
  // visible; only the wording changes with what is actually on screen.
  const staleNotice = scrapedError
    ? state === null
      ? `radar-data.json unavailable (${scrapedError}) — showing built-in defaults`
      : state.origin === "cache"
        ? `Could not load radar-data.json (${scrapedError}) — showing a cached copy published ${formatPublishedAt(updatedAt)}. Newly added sources will be missing until this loads.`
        : `Could not refresh radar-data.json (${scrapedError}) — showing the last edition that loaded successfully (published ${formatPublishedAt(updatedAt)}).`
    : null;

  return (
    <main className="min-h-screen w-full bg-white">
      {staleNotice && (
        <div className="mx-auto max-w-[1920px] px-4 pt-4 sm:px-6">
          <p
            role="alert"
            data-testid="radar-stale-banner"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
          >
            <strong>Radar data may be out of date.</strong> {staleNotice}
          </p>
        </div>
      )}
      <PipelineStatus onRefresh={fetchScraped} blipNames={names} />
      <TechRadar
        config={config}
        title={title}
        version={version}
        updatedAt={updatedAt}
      />
    </main>
  );
}
