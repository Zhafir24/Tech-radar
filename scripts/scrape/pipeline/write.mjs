/**
 * Write the frontend snapshot at public/radar-data.json — same shape as
 * `RadarSnapshot` in src/components/TechRadar/types.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { assignRing, movementFor } from "./assignRing.mjs";

const OUTPUT_FILE = path.join("public", "radar-data.json");
const PREVIOUS_FILE = path.join("data", "previous-rings.json");

/**
 * @param {import("./aggregate.mjs").Technology[]} selected
 * @param {object} baseConfig  The frontend's DEFAULT_RADAR_CONFIG (rings + quadrants).
 */
export function writeSnapshot(selected, baseConfig) {
  const previous = loadPrevious();
  const pipelineHasHistory = Object.keys(previous).length > 0;
  const currentRings = {};

  const blips = selected.map((tech) => {
    const ring = assignRing(tech);
    const status = movementFor(
      ring,
      previous[tech.slug],
      tech.firstSeen,
      pipelineHasHistory,
    );
    currentRings[tech.slug] = ring;

    const mostRecent = tech.mentions
      .filter((m) => m.publishedAt)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];

    const description = buildDescription(tech, mostRecent);

    return {
      id: tech.slug,
      // Stable across runs — assigned in aggregate.mjs → mergeWithStore.
      // Defensive fallback: 0 if the store somehow left it unassigned.
      number: tech.number > 0 ? tech.number : 0,
      name: tech.name,
      ring,
      quadrant: tech.quadrant,
      status,
      description,
      since: tech.firstSeen?.slice(0, 7) ?? "",
      updatedAt: new Date().toISOString(),
      owner: sourceLabel(tech),
    };
  });

  const snapshot = {
    meta: {
      title: "Tech Radar",
      version: buildVersion(),
      publishedAt: new Date().toISOString(),
    },
    config: {
      ...baseConfig,
      blips,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(snapshot, null, 2));
  savePrevious(currentRings);
  // `previous` snapshot returned so diagnostics can diff against the truly
  // previous rings (this write has just overwritten them on disk).
  return { path: OUTPUT_FILE, blipCount: blips.length, previousRings: previous, currentRings };
}

function buildDescription(tech, mostRecent) {
  const parts = [];
  if (tech.githubStars > 0) {
    parts.push(`${formatStars(tech.githubStars)} GitHub stars`);
  }
  if (mostRecent) {
    const sourceLabelText = shortSource(mostRecent.source);
    const dayText = mostRecent.publishedAt
      ? ` on ${mostRecent.publishedAt.slice(0, 10)}`
      : "";
    parts.push(`Latest from ${sourceLabelText}${dayText}`);
  }
  const totalMentions = tech.mentions.length;
  parts.push(`${totalMentions} recent mention${totalMentions === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function shortSource(id) {
  switch (id) {
    case "github-trending": return "GitHub Trending";
    // Historical ids kept for backward compatibility with older store entries
    // written before source-id unification (Aug 2026).
    case "thehackernews":
    case "thehackernews.com": return "The Hacker News";
    case "infoq":
    case "infoq.com": return "InfoQ";
    case "dev.to": return "dev.to";
    case "lobsters": return "Lobste.rs";
    default: return id;
  }
}

function sourceLabel(tech) {
  const sources = new Set(tech.mentions.map((m) => shortSource(m.source)));
  return [...sources].join(", ").slice(0, 60);
}

function formatStars(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildVersion() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}.${mm}`;
}

function loadPrevious() {
  try {
    if (!fs.existsSync(PREVIOUS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PREVIOUS_FILE, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function savePrevious(currentRings) {
  try {
    fs.mkdirSync(path.dirname(PREVIOUS_FILE), { recursive: true });
    fs.writeFileSync(PREVIOUS_FILE, JSON.stringify(currentRings, null, 2));
  } catch {
    // Non-fatal — movement will fall back to "no-change" next run.
  }
}
