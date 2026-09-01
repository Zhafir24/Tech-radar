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
    // Only a technology's OWN repository may set its star count.
    //
    // The trending scraper matches repos to technologies by alias text, so
    // taking the highest star count of anything that matched attributed
    // freeCodeCamp's 453k stars to TypeScript, awesome-go's to Go and
    // kubescape's 11.6k to Kubernetes (whose own repo has ~125k). Those are
    // false, externally checkable numbers, and assignRing keys on stars, so
    // they placed blips in the wrong ring too.
    //
    // A technology with no canonical repo on its taxonomy entry — AWS,
    // Anthropic Claude, SBOM — now reports no stars rather than borrowing
    // someone else's. githubStars.mjs refreshes the real figure from the API.
    if (mention.source === "github-trending" && mention.raw?.stars) {
      const canonical = SLUG_TO_ENTRY.get(mention.slug)?.repo;
      const seen = `${mention.raw.owner}/${mention.raw.repo}`;
      if (canonical && seen.toLowerCase() === canonical.toLowerCase()) {
        tech.githubStars = Number(mention.raw.stars) || 0;
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
 *
 * `enabledSourceIds` decides what the RADAR may show. The store on disk keeps
 * everything — turning a source back on restores its blips on the next scrape
 * without re-fetching history — but a technology is only returned when at
 * least one currently-enabled source still vouches for it, and its mention
 * list is narrowed to those sources so scoring is not inflated by evidence
 * the user has switched off.
 *
 * Without this, disabling a source removed its fetch but not its blips: every
 * technology it had ever contributed stayed in the store and kept being
 * selected, so the radar never changed.
 *
 * Pass `null`/omit to keep every source (used by tooling that has no config).
 *
 * @param {Technology[]} fresh
 * @param {Set<string>|string[]|null} [enabledSourceIds]
 */
export function mergeWithStore(fresh, enabledSourceIds = null) {
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

  // The full list is what persists: history is never destroyed by toggling a
  // source off, so toggling it back on restores those blips next run.
  const list = [...merged.values()];
  saveStore(list);

  return restrictToEnabledSources(list, enabledSourceIds);
}

/** Source id that supplies the GitHub star/url/age metadata. */
const GITHUB_SOURCE_ID = "github-trending";

/**
 * Narrow a merged list to what the enabled sources actually support.
 * Returns copies — the stored objects that were just persisted are untouched.
 *
 * Two things are stripped, so that a disabled source leaves no trace anywhere
 * on the radar:
 *   - mentions from sources that are off, and any tech left with none;
 *   - GitHub star/url/age metadata, which is evidence gathered by the
 *     github-trending source. Leaving it behind would keep "13.1k GitHub
 *     stars" on a blip whose GitHub source the user has switched off, and
 *     would keep inflating that tech's score.
 */
function restrictToEnabledSources(list, enabledSourceIds) {
  // Only a null/undefined sentinel means "do not filter". A plain falsy check
  // also let `false`, `0`, `""` and `NaN` through as no-filter, which is the
  // same shape as the bug where an empty Set returned the whole store.
  if (enabledSourceIds == null) return list;
  // A bare string is rejected on purpose: it IS iterable, so `"dev.to"` would
  // silently become a Set of single characters that matches no source at all.
  if (
    typeof enabledSourceIds === "string" ||
    typeof enabledSourceIds[Symbol.iterator] !== "function"
  ) {
    throw new TypeError(
      "restrictToEnabledSources: enabledSourceIds must be a Set or iterable " +
        "of source ids, or null/undefined to disable filtering — got " +
        typeof enabledSourceIds,
    );
  }
  const enabled =
    enabledSourceIds instanceof Set ? enabledSourceIds : new Set(enabledSourceIds);

  // An EMPTY set means "no source is enabled", so nothing is eligible. It does
  // NOT mean "no filter". Treating it as no-filter returned the entire store,
  // so turning every source off left the radar completely unchanged — the exact
  // opposite of what the user asked for. `null` is the way to opt out.
  if (enabled.size === 0) {
    log.info("no sources enabled — radar has nothing to show", {
      excluded: list.length,
    });
    return [];
  }

  const githubEnabled = enabled.has(GITHUB_SOURCE_ID);
  const kept = [];
  let excluded = 0;
  let starsStripped = 0;

  for (const tech of list) {
    const mentions = tech.mentions.filter((m) =>
      enabled.has(canonicalSourceId(m.source)),
    );
    if (mentions.length === 0) {
      excluded++;
      continue;
    }
    const copy = { ...tech, mentions };
    if (!githubEnabled && (copy.githubStars > 0 || copy.githubUrl)) {
      copy.githubStars = 0;
      copy.githubUrl = null;
      copy.githubRepoAgeDays = null;
      starsStripped++;
    }
    kept.push(copy);
  }

  if (excluded > 0) {
    log.info("techs held back — no enabled source vouches for them", {
      excluded,
      eligible: kept.length,
    });
  }
  if (starsStripped > 0) {
    log.info("GitHub metadata stripped — github-trending is disabled", {
      techs: starsStripped,
    });
  }
  return kept;
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
export const __test__ = {
  validateStored,
  assignStableNumbers,
  restrictToEnabledSources,
};
