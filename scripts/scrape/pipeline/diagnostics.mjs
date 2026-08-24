/**
 * Emit `public/radar-diagnostics.json` — the machine-readable pipeline
 * receipt consumed by the frontend status widget. Every field here has
 * observable evidence: source stats come from actual fetch results,
 * pipeline totals come from actual counts, changes come from a real
 * diff against the previous run's selection.
 */
import fs from "node:fs";
import path from "node:path";

const OUTPUT_FILE = path.join("public", "radar-diagnostics.json");

const SOURCE_DISPLAY_NAMES = {
  "dev.to": "dev.to",
  "github-trending": "GitHub Trending",
  "thehackernews": "The Hacker News",
  "infoq": "InfoQ",
  "lobsters": "Lobste.rs",
};

const RING_INDEX = { adopt: 0, trial: 1, assess: 2, emerging: 3 };

/**
 * @param {object} input
 * @param {number} input.startedAtMs
 * @param {Array<{id:string, items:any[], error?: string, skipped?: boolean, skipReason?: string}>} input.sourceResults
 * @param {number} input.candidatesCount
 * @param {number} input.mentionsCount
 * @param {number} input.aggregatedCount   Freshly aggregated (this run only).
 * @param {number} input.storeTotalCount   Total in persistent store after merge.
 * @param {import("./aggregate.mjs").Technology[]} input.selected
 * @param {Record<string,number>} input.byQuadrant
 * @param {Record<string,number>} input.byRing
 * @param {Record<string, "adopt"|"trial"|"assess"|"emerging">} input.currentRings
 * @param {Record<string, "adopt"|"trial"|"assess"|"emerging">} input.previousRings
 *        The rings from the run BEFORE this one — captured by writeSnapshot
 *        before it overwrites data/previous-rings.json. Passed in instead of
 *        loaded from disk here to avoid the "already overwritten" bug.
 */
export function writeDiagnostics(input) {
  const changes = computeChanges(input.previousRings ?? {}, input.currentRings);

  const sources = input.sourceResults.map((result) => {
    const base = {
      id: result.id,
      displayName:
        result.displayName ?? SOURCE_DISPLAY_NAMES[result.id] ?? result.id,
      itemCount: result.items?.length ?? 0,
    };
    if (result.skipped) {
      return { ...base, status: "skipped", reason: result.skipReason ?? "skipped" };
    }
    if (result.error) {
      return { ...base, status: "error", error: result.error };
    }
    // A source that returned no items completed the fetch but produced
    // nothing usable — usually a wrong URL or a JS-only site. Mark it as
    // "empty" so the widget can show amber rather than falsely-green ok.
    if ((result.items?.length ?? 0) === 0) {
      return { ...base, status: "empty" };
    }
    return { ...base, status: "ok" };
  });

  const successCount = sources.filter((s) => s.status === "ok").length;
  const activeCount = sources.filter((s) => s.status !== "skipped").length;
  const durationMs = Date.now() - input.startedAtMs;

  /** Overall health — used by the UI pill color. */
  let health = "ok";
  if (successCount === 0) health = "error";
  else if (successCount < activeCount) health = "warn";

  const diagnostics = {
    generatedAt: new Date().toISOString(),
    durationMs,
    health,
    sources,
    sourcesSummary: {
      ok: successCount,
      active: activeCount,
      total: sources.length,
    },
    pipeline: {
      candidates: input.candidatesCount,
      mentions: input.mentionsCount,
      technologiesFresh: input.aggregatedCount,
      technologiesInStore: input.storeTotalCount,
      selected: input.selected.length,
    },
    distribution: {
      byQuadrant: input.byQuadrant,
      byRing: input.byRing,
    },
    changes,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(diagnostics, null, 2));
  return diagnostics;
}

function computeChanges(previous, current) {
  const previousSlugs = new Set(Object.keys(previous));
  const currentSlugs = new Set(Object.keys(current));

  const added = [...currentSlugs].filter((s) => !previousSlugs.has(s));
  const removed = [...previousSlugs].filter((s) => !currentSlugs.has(s));

  const movedUp = [];
  const movedDown = [];
  for (const slug of currentSlugs) {
    const prevRing = previous[slug];
    const currRing = current[slug];
    if (!prevRing || prevRing === currRing) continue;
    if (RING_INDEX[currRing] < RING_INDEX[prevRing]) {
      movedUp.push({ slug, from: prevRing, to: currRing });
    } else if (RING_INDEX[currRing] > RING_INDEX[prevRing]) {
      movedDown.push({ slug, from: prevRing, to: currRing });
    }
  }

  const hasHistory = previousSlugs.size > 0;
  return { hasHistory, added, removed, movedUp, movedDown };
}
