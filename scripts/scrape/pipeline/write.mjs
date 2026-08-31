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
 * @param {Record<string, string>} [sourceNames]  Custom source id → display name,
 *   supplied by the caller. Passed in rather than read from
 *   data/sources-config.json here: a disk read inside this module would bind
 *   label rendering to process.cwd() and put it out of reach of unit tests.
 */
export function writeSnapshot(selected, baseConfig, sourceNames = {}) {
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

    const description = buildDescription(
      tech,
      pickAttributionMention(tech),
      sourceNames,
    );

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
      owner: sourceLabel(tech, sourceNames),
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

/**
 * The single mention the "Latest from X" clause is a claim about.
 *
 * Newest DATED mention first — the original rule, unchanged. What is new is the
 * fallback, and it exists because two fetcher tiers (the HTML link-scrape and
 * browser-render paths in fetchers/website.mjs) write `publishedAt: null`: a
 * scraped anchor carries no date. Selecting with `.filter(m => m.publishedAt)`
 * alone therefore produced `undefined` for any technology whose mentions ALL
 * come from such a source, and buildDescription's `if (mostRecent)` then dropped
 * the WHOLE attribution clause — the blip rendered a bare "1 recent mention"
 * naming no source, even though the source id had been known the entire time.
 * On a real snapshot that was 11 of 21 blips (Qwen, Rust, SQLite, Bun, …).
 * Attribution must not depend on having a date, so fall back to an undated one.
 *
 * The fallback deliberately takes the FIRST mention in array order rather than
 * scanning for a "best" one: it is stable across runs on identical input.
 * aggregate.mjs sorts mentions newest-first treating undated ones as epoch 0,
 * and Array#sort is stable, so undated mentions sit at the end in the document
 * order the scraper read them — index-page top link first, which is as close to
 * "latest" as a dateless tier can get.
 *
 * @param {import("./aggregate.mjs").Technology} tech
 * @returns {import("./extract.mjs").Mention|undefined} `undefined` only when
 *   there are no mentions at all, so the clause is omitted rather than rendered
 *   with a placeholder source.
 */
function pickAttributionMention(tech) {
  const mentions = Array.isArray(tech?.mentions) ? tech.mentions : [];
  const newestDated = mentions
    .filter((m) => m?.publishedAt)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  return newestDated ?? mentions[0];
}

function buildDescription(tech, mostRecent, sourceNames = {}) {
  const parts = [];
  if (tech.githubStars > 0) {
    parts.push(`${formatStars(tech.githubStars)} GitHub stars`);
  }
  if (mostRecent) {
    const sourceLabelText = mentionSourceLabel(mostRecent, sourceNames);
    // Undated mentions are now routine here, not a theoretical edge case (see
    // pickAttributionMention). The wording stays "Latest from X" and simply
    // loses the date rather than becoming a second sentence shape: the clause's
    // job is attribution, one shape keeps a missing date reading as "no date
    // recorded" instead of as a different kind of fact, and the undated mention
    // we pick IS the topmost — i.e. newest-looking — link the scraper saw.
    // Never emit a trailing " on " with nothing after it: an empty dayText
    // would state a date we do not have.
    const dayText = mostRecent.publishedAt
      ? ` on ${mostRecent.publishedAt.slice(0, 10)}`
      : "";
    parts.push(`Latest from ${sourceLabelText}${dayText}`);
  }
  const totalMentions = tech.mentions.length;
  parts.push(`${totalMentions} recent mention${totalMentions === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Longest label a single source may contribute — matches the API's name cap. */
const MAX_SOURCE_LABEL = 60;

/** Shown instead of an empty string when a mention carries no id at all. */
const UNKNOWN_SOURCE = "unknown source";

/**
 * Label derivable from the id alone: built-in switch, then the caller's
 * id → name map. Returns null when the id is unknown, so each call site can
 * pick its own last resort.
 *
 * @param {string} id  mention.source
 * @param {Record<string, string>} [sourceNames]  custom source id → display name
 * @returns {string|null}
 */
function knownSourceLabel(id, sourceNames = {}) {
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
  }

  // typeof guard, not `in`: a plain object still inherits `constructor` and
  // friends, and an id colliding with one would render "function Object()".
  const configured = sourceNames?.[id];
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().slice(0, MAX_SOURCE_LABEL);
  }
  return null;
}

/**
 * Label for ONE specific mention, for the "Latest from X on DATE" sentence.
 *
 * A removed custom source keeps its mentions in data/tech-store.json but loses
 * its name from sources-config, so the hash id is all that's left. The article's
 * own hostname is a true statement about THAT article, which is why the
 * hostname step is allowed here and nowhere else.
 */
function mentionSourceLabel(mention, sourceNames = {}) {
  const known = knownSourceLabel(mention?.source, sourceNames);
  if (known) return known;
  const host = hostLabel(mention?.url);
  if (host) return host;
  return typeof mention?.source === "string" && mention.source
    ? mention.source
    : UNKNOWN_SOURCE;
}

/**
 * Label for a source id in the distinct-source list. Deliberately id-only:
 * an aggregator feed links out to many domains, so a per-mention hostname
 * fallback here would split one source into six entries and inflate the count
 * the owner field is meant to report.
 */
function sourceIdLabel(id, sourceNames = {}) {
  const known = knownSourceLabel(id, sourceNames);
  if (known) return known;
  return typeof id === "string" && id ? id : UNKNOWN_SOURCE;
}

/** Hostname of an article url, minus `www.`; "" when there is nothing usable. */
function hostLabel(url) {
  // new URL() throws on a missing or malformed href, and mentions replayed from
  // an old store carry whatever the fetcher wrote at the time.
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function sourceLabel(tech, sourceNames = {}) {
  const sources = new Set(
    tech.mentions.map((m) => sourceIdLabel(m.source, sourceNames)),
  );
  return [...sources].join(", ").slice(0, MAX_SOURCE_LABEL);
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

// Exported only for unit tests.
export const __test__ = {
  sourceIdLabel,
  mentionSourceLabel,
  sourceLabel,
  buildDescription,
  pickAttributionMention,
};
