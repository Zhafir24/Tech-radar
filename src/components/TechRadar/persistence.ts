import type { RadarConfig } from "./types";
import { DEFAULT_RADAR_CONFIG } from "./radarConfig";

/**
 * Shared draft/published persistence for the radar ecosystem.
 *
 * The admin console edits a DRAFT snapshot (autosaved) and can PUBLISH it;
 * the public radar page renders the PUBLISHED snapshot. In this mockup both
 * pages run on the same origin so localStorage acts as the data bridge —
 * a production deployment on separate domains would replace this module
 * with an API client while keeping the same snapshot shape.
 */

export interface RadarMeta {
  title: string;
  version: string;
  publishState: "draft" | "published";
  /** ISO timestamp of the last publish, or null if never published. */
  publishedAt: string | null;
}

export interface RadarSnapshot {
  meta: RadarMeta;
  config: RadarConfig;
}

export const PUBLISHED_KEY = "pnm-radar-published";
export const DRAFT_KEY = "pnm-radar-draft";

export const DEFAULT_META: RadarMeta = {
  title: "Tech Radar",
  version: "2026.05",
  publishState: "draft",
  publishedAt: null,
};

/** Deep-cloned default snapshot (safe to mutate). */
export function defaultSnapshot(): RadarSnapshot {
  return structuredClone({ meta: DEFAULT_META, config: DEFAULT_RADAR_CONFIG });
}

/**
 * Merge a stored config over the defaults so snapshots saved by older
 * versions of the app never leave newer nested fields undefined.
 */
function mergeConfig(stored: RadarConfig): RadarConfig {
  const base = DEFAULT_RADAR_CONFIG;
  return {
    ...base,
    ...stored,
    viewBox: { ...base.viewBox, ...stored.viewBox },
    center: { ...base.center, ...stored.center },
    axis: { ...base.axis, ...stored.axis },
    blipStyle: { ...base.blipStyle, ...stored.blipStyle },
    scatter: { ...base.scatter, ...stored.scatter },
  };
}

function isValidSnapshot(value: unknown): value is RadarSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snap = value as RadarSnapshot;
  return (
    typeof snap.meta?.title === "string" &&
    typeof snap.meta?.version === "string" &&
    Array.isArray(snap.config?.rings) &&
    snap.config.rings.length === 4 &&
    Array.isArray(snap.config?.quadrants) &&
    snap.config.quadrants.length === 4 &&
    Array.isArray(snap.config?.blips) &&
    snap.config.blips.every(
      (b) => typeof b?.id === "string" && typeof b?.name === "string",
    )
  );
}

export function loadSnapshot(key: string): RadarSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSnapshot(parsed)) return null;
    return { meta: parsed.meta, config: mergeConfig(parsed.config) };
  } catch {
    return null;
  }
}

export function saveSnapshot(key: string, snapshot: RadarSnapshot): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Parse text (e.g. an imported .json file) into a validated snapshot. */
export function parseSnapshot(text: string): RadarSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isValidSnapshot(parsed)) return null;
    return { meta: parsed.meta, config: mergeConfig(parsed.config) };
  } catch {
    return null;
  }
}
