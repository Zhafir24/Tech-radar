/**
 * Aggregate mentions into technologies, then merge with the persistent
 * tech store (data/tech-store.json) so we accumulate history across runs
 * and never lose a stable id when a tech disappears for one day.
 *
 * Two data-integrity invariants are enforced here — they exist because the
 * store lives on disk indefinitely and diverges from the taxonomy over time:
 *
 *   1. Every stored tech's `name` and `quadrant` are ALWAYS refreshed from
 *      the current taxonomy on merge. If you rename or move an entry in
 *      taxonomy.mjs, the change propagates on the next scrape.
 *   2. Stored techs whose slug is no longer in the taxonomy are DROPPED.
 *      No orphan blips.
 *
 * A third invariant enforces UX stability:
 *
 *   3. `number` is assigned once per slug and preserved across runs. The
 *      first ever appearance gets the next unused integer; subsequent runs
 *      reuse the same number. This keeps the legend order stable so users
 *      can reliably reference "blip #42".
 */
import fs from "node:fs";
import path from "node:path";
import { SLUG_TO_ENTRY } from "../taxonomy.mjs";
import { log } from "../logger.mjs";

/**
 * @typedef {Object} Technology
 * @property {string} slug
 * @property {string} name
 * @property {"infrastructure"|"ai-automation"|"security"|"data-integration"} quadrant
 * @property {number} number       Stable ordinal, assigned once per slug.
 * @property {import("./extract.mjs").Mention[]} mentions
 * @property {string} firstSeen  ISO date first ingested by the pipeline.
 * @property {string} lastSeen   ISO date most recently ingested.
 * @property {number} githubStars 0 if never seen on GitHub Trending.
 * @property {string|null} githubUrl `https://github.com/owner/repo` or null.
 * @property {number|null} githubRepoAgeDays Best-effort repo age from GitHub.
 * @property {Record<string,number>} [scores]  Populated by score.mjs.
 * @property {number} [overallScore]           Populated by score.mjs.
 */

const STORE_FILE = path.join("data", "tech-store.json");
const MAX_MENTIONS_PER_TECH = 40;
const VALID_QUADRANTS = new Set([
  "infrastructure",
  "ai-automation",
  "security",
  "data-integration",
]);

/**
 * Rewrites of legacy source ids to the canonical id used by index.mjs
 * and the fetcher after the Aug-2026 unification. Prevents historical
 * mentions from being counted as a separate source in scoring
 * (sourceCount = new Set(mentions.map(m => m.source)).size).
 */
const SOURCE_ID_MIGRATIONS = new Map([
  ["thehackernews.com", "thehackernews"],
  ["infoq.com", "infoq"],
]);

function canonicalSourceId(id) {
  return SOURCE_ID_MIGRATIONS.get(id) ?? id;
}

/**
 * @param {import("./extract.mjs").Mention[]} mentions
 * @returns {Technology[]}
 */
export function aggregate(mentions) {
  const bag = new Map();
  const now = new Date().toISOString();

  for (const mention of mentions) {
    const entry = SLUG_TO_ENTRY.get(mention.slug);
    if (!entry) continue;
    if (!bag.has(mention.slug)) {
      bag.set(mention.slug, {
        slug: entry.slug,
        name: entry.name,
        quadrant: entry.quadrant,
        number: 0, // Assigned by mergeWithStore.
        mentions: [],
        firstSeen: now,
        lastSeen: now,
        githubStars: 0,
        githubUrl: null,
        githubRepoAgeDays: null,
      });
    }
    const tech = bag.get(mention.slug);
    tech.mentions.push(mention);
    if (mention.source === "github-trending" && mention.raw?.stars) {
      const stars = Number(mention.raw.stars) || 0;
      if (stars > tech.githubStars) {
        tech.githubStars = stars;
        tech.githubUrl = mention.url;
      }
    }
  }

  return [...bag.values()];
}

/**
 * Merge fresh technologies with the persistent store on disk.
 *
 * - Refreshes each entry's `name`/`quadrant` from the current taxonomy.
 * - Drops entries whose slug is no longer in the taxonomy or whose data is
 *   malformed (missing slug, invalid quadrant, non-array mentions).
 * - Preserves per-slug `number` across runs; assigns the next unused
 *   integer to newly-seen slugs.
 */
export function mergeWithStore(fresh) {
  const stored = loadStore();
  const merged = new Map();

  // 1. Rehydrate stored entries — drop unknown/invalid, refresh from taxonomy.
  let dropped = 0;
  for (const raw of stored) {
    const entry = validateStored(raw);
    if (!entry) {
      dropped++;
      continue;
    }
    merged.set(entry.slug, entry);
  }
  if (dropped > 0) log.info("store entries dropped as stale/invalid", { dropped });

  // 2. Fold in fresh technologies (add new slugs, merge mentions into existing).
  const nowIso = new Date().toISOString();
  for (const tech of fresh) {
    const existing = merged.get(tech.slug);
    if (!existing) {
      merged.set(tech.slug, { ...tech });
      continue;
    }
    // Merge mention lists, dedup on url+source, cap.
    const seen = new Set(existing.mentions.map((m) => `${m.source}|${m.url}`));
    for (const mention of tech.mentions) {
      const key = `${mention.source}|${mention.url}`;
      if (!seen.has(key)) {
        existing.mentions.push(mention);
        seen.add(key);
      }
    }
    // Keep the freshest N mentions.
    existing.mentions.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    });
    existing.mentions = existing.mentions.slice(0, MAX_MENTIONS_PER_TECH);
    existing.lastSeen = nowIso;
    if (tech.githubStars > (existing.githubStars ?? 0)) {
      existing.githubStars = tech.githubStars;
      existing.githubUrl = tech.githubUrl;
    }
  }

  // 3. Assign stable numbers — reuse existing, allocate next-highest for new.
  assignStableNumbers(merged);

  const list = [...merged.values()];
  saveStore(list);
  return list;
}

/**
 * Validate one raw store entry and return a taxonomy-refreshed copy, or
 * null if the entry should be dropped (unknown slug, invalid quadrant,
 * missing required fields, etc.).
 */
function validateStored(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slug = typeof raw.slug === "string" ? raw.slug : null;
  if (!slug) return null;
  const entry = SLUG_TO_ENTRY.get(slug);
  if (!entry) return null; // Removed from taxonomy — drop.
  if (!VALID_QUADRANTS.has(entry.quadrant)) return null;

  const mentions = Array.isArray(raw.mentions)
    ? raw.mentions
        .filter(
          (m) =>
            m &&
            typeof m === "object" &&
            typeof m.slug === "string" &&
            typeof m.source === "string" &&
            typeof m.url === "string",
        )
        // Migrate legacy source ids so scoring doesn't double-count the same
        // real source under two different string forms.
        .map((m) => ({ ...m, source: canonicalSourceId(m.source) }))
    : [];

  const stars = Number(raw.githubStars);
  const numberRaw = Number(raw.number);

  return {
    slug: entry.slug,
    // Always refresh display name + quadrant from the current taxonomy.
    name: entry.name,
    quadrant: entry.quadrant,
    number: Number.isFinite(numberRaw) && numberRaw > 0 ? Math.trunc(numberRaw) : 0,
    mentions,
    firstSeen: typeof raw.firstSeen === "string" ? raw.firstSeen : new Date().toISOString(),
    lastSeen: typeof raw.lastSeen === "string" ? raw.lastSeen : new Date().toISOString(),
    githubStars: Number.isFinite(stars) && stars >= 0 ? stars : 0,
    githubUrl: typeof raw.githubUrl === "string" ? raw.githubUrl : null,
    githubRepoAgeDays:
      typeof raw.githubRepoAgeDays === "number" ? raw.githubRepoAgeDays : null,
  };
}

/**
 * Assign a stable ordinal to each tech. Existing numbers are preserved;
 * new (number === 0) or duplicate/collision numbers get the next unused
 * integer. Deterministic regardless of insertion order.
 */
function assignStableNumbers(techMap) {
  const used = new Set();
  const needsNumber = [];

  for (const tech of techMap.values()) {
    if (tech.number > 0 && !used.has(tech.number)) {
      used.add(tech.number);
    } else {
      needsNumber.push(tech);
    }
  }

  // Sort unassigned by firstSeen (oldest first) so numbering is chronological.
  needsNumber.sort((a, b) =>
    (a.firstSeen ?? "").localeCompare(b.firstSeen ?? ""),
  );

  let next = 1;
  for (const tech of needsNumber) {
    while (used.has(next)) next++;
    tech.number = next;
    used.add(next);
  }
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log.warn("tech-store is not an array — starting fresh");
      return [];
    }
    return parsed;
  } catch (err) {
    log.warn("tech-store load failed", { error: err.message });
    return [];
  }
}

function saveStore(list) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    log.warn("tech-store save failed", { error: err.message });
  }
}

// Exported only for unit tests.
export const __test__ = { validateStored, assignStableNumbers };
