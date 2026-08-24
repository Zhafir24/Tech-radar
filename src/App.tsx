import { useCallback, useEffect, useMemo, useState } from "react";
import { TechRadar } from "./components/TechRadar";
import { PipelineStatus, blipNameMap } from "./components/PipelineStatus";
import {
  PUBLISHED_KEY,
  loadSnapshot,
  type RadarSnapshot,
} from "./components/TechRadar/persistence";
import { DEFAULT_RADAR_CONFIG } from "./components/TechRadar/radarConfig";

/**
 * Cache key for the last successful /radar-data.json fetch. Loaded
 * synchronously on mount so the first paint already has real scraped data
 * instead of briefly flashing the compiled-in DEFAULT_RADAR_CONFIG before
 * the async fetch resolves.
 */
const SCRAPED_CACHE_KEY = "pnm-radar-scraped-cache";

function loadScrapedCache(): RadarSnapshot | null {
  try {
    const raw = localStorage.getItem(SCRAPED_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RadarSnapshot;
    if (
      parsed &&
      Array.isArray(parsed.config?.blips) &&
      Array.isArray(parsed.config?.rings) &&
      Array.isArray(parsed.config?.quadrants)
    ) {
      return parsed;
    }
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
 * Public radar. Data source resolution, in priority order:
 *   1. localStorage published snapshot (admin console override — user
 *      intent takes precedence over automation)
 *   2. /radar-data.json served by Vite (scraper output)
 *   3. Compiled-in DEFAULT_RADAR_CONFIG (offline fallback)
 *
 * A `storage` listener keeps the page live when the admin publishes from
 * another tab on the same origin.
 *
 * The PipelineStatus widget above the radar surfaces the scraper's
 * per-source stats and change diff so it's obvious whether the pipeline
 * actually ran and whether anything changed since the last edition.
 */
export default function App() {
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(() =>
    loadSnapshot(PUBLISHED_KEY),
  );
  // Seed from localStorage cache so the first paint already has real data
  // instead of flashing the compiled-in defaults.
  const [scraped, setScraped] = useState<RadarSnapshot | null>(loadScrapedCache);
  const [scrapedError, setScrapedError] = useState<string | null>(null);

  const fetchScraped = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/radar-data.json", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RadarSnapshot | null;
      if (
        data &&
        Array.isArray(data.config?.blips) &&
        Array.isArray(data.config?.rings) &&
        Array.isArray(data.config?.quadrants)
      ) {
        setScraped(data);
        setScrapedError(null);
        saveScrapedCache(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setScrapedError(err.message);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchScraped(controller.signal);
    return () => controller.abort();
  }, [fetchScraped]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PUBLISHED_KEY) {
        setSnapshot(loadSnapshot(PUBLISHED_KEY));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const source = snapshot ?? scraped;
  const config = source?.config ?? DEFAULT_RADAR_CONFIG;
  const title = source?.meta.title ?? "Tech Radar";
  const version = source?.meta.version ?? "2026.05";
  const updatedAt = source?.meta.publishedAt ?? null;

  const names = useMemo(() => blipNameMap(config.blips), [config.blips]);

  return (
    <main className="min-h-screen w-full bg-white">
      {scrapedError && !source && (
        <p
          role="status"
          className="mx-auto max-w-[1920px] px-6 pt-4 text-xs text-slate-400"
        >
          radar-data.json unavailable ({scrapedError}) — showing built-in defaults
        </p>
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
