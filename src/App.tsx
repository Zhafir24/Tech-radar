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
 *   1. /radar-data.json served by Vite (scraper output)
 *   2. Compiled-in DEFAULT_RADAR_CONFIG (offline fallback)
 *
 * The scraper is the single source of truth: what it writes is what the
 * radar shows. Add or toggle sources and trigger a run from the
 * PipelineStatus widget above the radar, which also surfaces per-source
 * stats and the change diff so it's obvious whether the pipeline actually
 * ran and whether anything moved since the last edition.
 */
export default function App() {
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

  const source = scraped;
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
