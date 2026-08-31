#!/usr/bin/env node
/**
 * Pipeline entry: `npm run scrape`.
 *
 * Sequential phases:
 *   1. Fetch each source in parallel; a single failure never aborts.
 *   2. Extract technology mentions via the taxonomy.
 *   3. Aggregate mentions into a technology map.
 *   4. Merge with persistent store (data/tech-store.json).
 *   5. Score, rank, select top 100 balanced across quadrants.
 *   6. Assign rings & movement, write public/radar-data.json.
 *   7. Emit public/radar-diagnostics.json for the frontend status widget.
 *   8. Print a summary.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, initFileLog } from "./logger.mjs";
import { fetchDevTo } from "./fetchers/devTo.mjs";
import { fetchGitHubTrending } from "./fetchers/github.mjs";
import { fetchHackerNews, fetchInfoQ } from "./fetchers/rss.mjs";
import { fetchLobsters } from "./fetchers/lobsters.mjs";
import { fetchWebsite } from "./fetchers/website.mjs";
import { extractMentions } from "./pipeline/extract.mjs";
import { aggregate, mergeWithStore } from "./pipeline/aggregate.mjs";
import { score } from "./pipeline/score.mjs";
import { selectTop } from "./pipeline/select.mjs";
import { writeSnapshot } from "./pipeline/write.mjs";
import { writeDiagnostics } from "./pipeline/diagnostics.mjs";
import { loadSourcesConfig } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(ROOT);
const logFile = initFileLog(path.join(ROOT, "data", "logs"));
const startedAtMs = Date.now();
log.info("pipeline start", { logFile, cwd: ROOT });

/*
 * Sources are assembled from data/sources-config.json so the "Manage sources"
 * widget can toggle built-ins on/off and add custom RSS feeds without a code
 * change. If a built-in is disabled it's simply skipped this run. Custom
 * entries are always treated as RSS/Atom via the generic fetchRss adapter.
 */
const sourcesConfig = loadSourcesConfig();

const BUILT_IN_SOURCES = [
  { id: "dev.to", displayName: "dev.to", fn: fetchDevTo },
  { id: "github-trending", displayName: "GitHub Trending", fn: fetchGitHubTrending },
  { id: "thehackernews", displayName: "The Hacker News", fn: fetchHackerNews },
  { id: "infoq", displayName: "InfoQ", fn: fetchInfoQ },
  { id: "lobsters", displayName: "Lobste.rs", fn: fetchLobsters },
];

const enabledBuiltIn = BUILT_IN_SOURCES.filter(
  (s) => sourcesConfig.builtIn[s.id]?.enabled !== false,
);

const customSources = sourcesConfig.custom
  .filter((c) => c.enabled !== false)
  .map((c) => ({
    id: c.id,
    displayName: c.name,
    fn: () => fetchWebsite(c.id, c.url),
  }));

/*
 * Every custom name, including disabled ones — blip descriptions render the
 * source a mention came from, and the store still holds mentions from sources
 * that are switched off. Built-in labels stay hardcoded in write.mjs.
 */
const customSourceNames = Object.fromEntries(
  sourcesConfig.custom.map((c) => [c.id, c.name]),
);

const sources = [...enabledBuiltIn, ...customSources];
log.info("sources selected", {
  builtInActive: enabledBuiltIn.map((s) => s.id),
  builtInDisabled: BUILT_IN_SOURCES.filter(
    (s) => sourcesConfig.builtIn[s.id]?.enabled === false,
  ).map((s) => s.id),
  custom: customSources.map((s) => s.id),
});

const settled = await Promise.allSettled(
  sources.map(async (source) => {
    try {
      const items = await source.fn();
      return {
        id: source.id,
        displayName: source.displayName,
        items,
        skipped: source.skipped,
        skipReason: source.skipReason,
      };
    } catch (err) {
      log.warn(`${source.id} threw`, { error: err.message });
      return {
        id: source.id,
        displayName: source.displayName,
        items: [],
        error: err.message,
      };
    }
  }),
);

const sourceResults = [];
const candidates = [];
for (const result of settled) {
  if (result.status === "fulfilled") {
    sourceResults.push(result.value);
    candidates.push(...result.value.items);
    log.info("source complete", {
      id: result.value.id,
      count: result.value.items.length,
      skipped: result.value.skipped ?? false,
      error: result.value.error ?? null,
    });
  } else {
    // A promise rejection means our wrapper failed — record it as an error source.
    sourceResults.push({ id: "unknown", items: [], error: String(result.reason) });
    log.error("source promise rejected", { reason: String(result.reason) });
  }
}
log.info("candidates collected", { total: candidates.length });

const mentions = extractMentions(candidates);
log.info("mentions extracted", { total: mentions.length });

const freshTechs = aggregate(mentions);
log.info("technologies aggregated", { fresh: freshTechs.length });

// Only technologies vouched for by a currently-enabled source may reach the
// radar. The store itself keeps everything, so re-enabling a source brings its
// blips back on the next run without refetching history.
const enabledSourceIds = new Set(sources.map((s) => s.id));
const allTechs = mergeWithStore(freshTechs, enabledSourceIds);
log.info("store merged", { eligible: allTechs.length });

const scored = allTechs.map(score).sort((a, b) => b.overallScore - a.overallScore);
const selected = selectTop(scored);
log.info("selection complete", { selected: selected.length });

const baseConfigModuleUrl = new URL("../../src/components/TechRadar/radarConfig.ts", import.meta.url);
const baseConfigText = fs.readFileSync(fileURLToPath(baseConfigModuleUrl), "utf8");
const baseConfig = extractBaseConfig(baseConfigText);
assertValidBaseConfig(baseConfig);

const { path: outPath, blipCount, previousRings, currentRings } = writeSnapshot(
  selected,
  baseConfig,
  customSourceNames,
);
log.info("snapshot written", { file: outPath, blips: blipCount });

/* Distribution — derived from the ring assignments writeSnapshot returned. */
const byQuadrant = {};
const byRing = {};
for (const tech of selected) {
  byQuadrant[tech.quadrant] = (byQuadrant[tech.quadrant] ?? 0) + 1;
}
for (const ring of Object.values(currentRings)) {
  byRing[ring] = (byRing[ring] ?? 0) + 1;
}

const diagnostics = writeDiagnostics({
  startedAtMs,
  sourceResults,
  candidatesCount: candidates.length,
  mentionsCount: mentions.length,
  aggregatedCount: freshTechs.length,
  storeTotalCount: allTechs.length,
  selected,
  byQuadrant,
  byRing,
  currentRings,
  previousRings,
});

log.info("diagnostics written", {
  file: "public/radar-diagnostics.json",
  sourcesOk: diagnostics.sourcesSummary.ok,
  changesAdded: diagnostics.changes.added.length,
  changesRemoved: diagnostics.changes.removed.length,
  changesMovedUp: diagnostics.changes.movedUp.length,
  changesMovedDown: diagnostics.changes.movedDown.length,
});
log.info("pipeline done", { durationMs: diagnostics.durationMs });

console.log("\n────────────────────────────────────────────────────────");
console.log(`Wrote ${blipCount} blips → ${path.relative(ROOT, outPath)}`);
console.log(`Sources ok: ${diagnostics.sourcesSummary.ok}/${diagnostics.sourcesSummary.active}`);
console.log("Quadrants:", byQuadrant);
console.log("Rings:    ", byRing);
console.log(
  `Changes:   +${diagnostics.changes.added.length}  −${diagnostics.changes.removed.length}` +
    `  ↑${diagnostics.changes.movedUp.length}  ↓${diagnostics.changes.movedDown.length}`,
);
console.log("────────────────────────────────────────────────────────\n");

/**
 * Extract the rings + quadrants + related base fields from radarConfig.ts.
 * Cheap regex-based read — good enough because we control the source file
 * shape. Returns a partial RadarConfig with all non-blip fields set to
 * the frontend's current values so the snapshot renders identically.
 */
function extractBaseConfig(source) {
  const evalable = source
    .replace(/export const DEFAULT_RADAR_CONFIG: RadarConfig = /, "return ")
    .replace(/import[\s\S]*?;\s*/g, "")
    .replace(/export function[\s\S]*$/m, "");
  const wrapped = `(function() { const obj = ${evalable.match(/return (\{[\s\S]*?\n\});/)?.[1]}; return obj; })()`;
  try {
    const config = new Function("return " + wrapped)();
    return {
      viewBox: config.viewBox,
      center: config.center,
      outerRadius: config.outerRadius,
      background: config.background,
      textColor: config.textColor,
      axis: config.axis,
      blipStyle: config.blipStyle,
      scatter: config.scatter,
      rings: config.rings,
      quadrants: config.quadrants,
    };
  } catch (err) {
    log.error("base config extract threw", { error: err.message });
    return {};
  }
}

/**
 * Fail loud if the base config we pulled from radarConfig.ts is missing
 * anything the frontend needs to render. Better to abort the pipeline than
 * to silently write a snapshot the app can't consume.
 */
function assertValidBaseConfig(config) {
  const problems = [];
  if (!Array.isArray(config?.rings) || config.rings.length === 0) {
    problems.push("rings[] missing/empty");
  }
  if (!Array.isArray(config?.quadrants) || config.quadrants.length === 0) {
    problems.push("quadrants[] missing/empty");
  }
  if (!config?.center || typeof config.center.x !== "number") {
    problems.push("center.x missing");
  }
  if (typeof config?.outerRadius !== "number") {
    problems.push("outerRadius missing");
  }
  if (problems.length > 0) {
    const msg =
      "extractBaseConfig failed to produce a usable RadarConfig: " +
      problems.join(", ") +
      ". Check the shape of DEFAULT_RADAR_CONFIG in src/components/TechRadar/radarConfig.ts.";
    log.error("base config invalid", { problems });
    throw new Error(msg);
  }
}
