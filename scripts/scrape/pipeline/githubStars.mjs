/**
 * Real GitHub star counts, read from the repository the technology actually
 * lives in.
 *
 * Why this exists: the trending scraper only knows which repos are trending,
 * not which technology each one *is*. aggregate.mjs used to attach the highest
 * star count of any trending repo whose text matched a taxonomy alias, so the
 * TypeScript blip reported freeCodeCamp's 453k stars, Go reported awesome-go's,
 * and Kubernetes reported kubescape's 11.6k instead of its own 125k. Those are
 * false, externally checkable claims, and because assignRing keys on stars they
 * also put blips in the wrong ring.
 *
 * A technology's star count now comes from the canonical `repo` declared on its
 * taxonomy entry, fetched from the documented GitHub REST API. A technology
 * with no canonical repo — AWS, Anthropic Claude, SBOM — reports no stars at
 * all, which is honest, rather than borrowing a number from something else.
 *
 * Anti-hallucination rule for this module: it NEVER writes a number it did not
 * receive from the API. Every failure path leaves the previous cached value in
 * place, or leaves the technology with no stars. It must never guess.
 */
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.mjs";
import { SLUG_TO_ENTRY } from "../taxonomy.mjs";

const CACHE_FILE = path.join("data", "github-repos.json");
const API_ROOT = "https://api.github.com/repos/";

/** Star counts older than this are refetched. A day is well inside the drift. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Unauthenticated GitHub allows 60 requests per hour per IP. Stay well under
 * it: the scraper may run several times an hour while the user experiments
 * with sources, and exhausting the budget would 403 every later run.
 */
const MAX_FETCHES_PER_RUN = 25;

/** Leave headroom so a burst of runs cannot lock the user out of the API. */
const RATE_LIMIT_FLOOR = 10;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Attach real star counts to `techs`, in place of whatever the trending
 * scraper guessed.
 *
 * @param {import("./aggregate.mjs").Technology[]} techs
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] False skips all network work and
 *   leaves every technology untouched — used when github-trending is switched
 *   off, so disabling that source still removes GitHub data from the radar.
 * @returns {Promise<import("./aggregate.mjs").Technology[]>} New array; inputs
 *   are not mutated.
 */
export async function enrichGitHubStars(techs, options = {}) {
  const { enabled = true } = options;
  if (!enabled) {
    log.info("github star enrichment skipped — github-trending is disabled");
    return techs;
  }

  const cache = loadCache();
  const now = Date.now();

  // Deterministic order: the fetch budget is finite, so which repos get
  // refreshed must not depend on object iteration order. Highest cached star
  // count first, so the most prominent blips stay the most current.
  const wanted = [];
  for (const tech of techs) {
    const repo = SLUG_TO_ENTRY.get(tech.slug)?.repo;
    if (!repo) continue;
    wanted.push({ slug: tech.slug, repo, cached: cache[repo] ?? null });
  }
  wanted.sort((a, b) => (b.cached?.stars ?? 0) - (a.cached?.stars ?? 0));

  let fetched = 0;
  let served = 0;
  let failed = 0;
  let budgetStop = null;

  for (const item of wanted) {
    const cached = cache[item.repo];
    if (cached && now - Date.parse(cached.fetchedAt || 0) < CACHE_TTL_MS) {
      served++;
      continue;
    }
    if (fetched >= MAX_FETCHES_PER_RUN) {
      budgetStop = "per-run cap";
      break;
    }
    const result = await fetchRepo(item.repo);
    if (result.rateLimited) {
      budgetStop = "GitHub rate limit";
      break;
    }
    fetched++;
    if (!result.ok) {
      failed++;
      // Deliberately keep any stale cached value rather than zeroing it: an
      // outage must not silently rewrite a real number to nothing.
      continue;
    }
    cache[item.repo] = result.record;
  }

  saveCache(cache);
  log.info("github stars enriched", {
    candidates: wanted.length,
    fetched,
    fromCache: served,
    failed,
    stoppedEarly: budgetStop,
  });

  return techs.map((tech) => applyCached(tech, cache));
}

/**
 * Replace a technology's GitHub fields with the canonical repo's cached data.
 * A technology with no canonical repo, or whose repo has never been fetched
 * successfully, ends up with no GitHub data at all — never a borrowed number.
 */
function applyCached(tech, cache) {
  const repo = SLUG_TO_ENTRY.get(tech.slug)?.repo;
  const record = repo ? cache[repo] : null;
  if (!record) {
    // Clear whatever the trending matcher may have left behind. This is the
    // line that stops freeCodeCamp's stars from ever reaching TypeScript.
    if (!tech.githubStars && !tech.githubUrl) return tech;
    return { ...tech, githubStars: 0, githubUrl: null, githubRepoAgeDays: null };
  }
  return {
    ...tech,
    githubStars: record.stars,
    githubUrl: record.url,
    githubRepoAgeDays: record.repoAgeDays ?? null,
  };
}

/**
 * One repository lookup.
 *
 * Uses fetch directly rather than http.mjs's fetchWithRetry because this needs
 * the response headers (x-ratelimit-remaining) to stop cleanly, and because
 * retrying a 403 rate-limit response would make the exhaustion worse.
 */
async function fetchRepo(repo) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_ROOT + repo, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tech-radar-scraper",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    if (response.status === 403 || response.status === 429) {
      log.warn("github api rate limited", { repo, remaining });
      return { rateLimited: true, ok: false };
    }
    if (!response.ok) {
      // A 404 means the taxonomy's repo is wrong or the project moved. Say so
      // loudly — a wrong mapping must be visible, not silently starless.
      log.warn("github repo lookup failed", { repo, status: response.status });
      return { ok: false };
    }

    const body = await response.json();
    const stars = Number(body?.stargazers_count);
    if (!Number.isFinite(stars) || stars < 0) {
      log.warn("github repo returned no usable star count", { repo });
      return { ok: false };
    }

    const createdMs = Date.parse(body?.created_at ?? "");
    return {
      ok: true,
      record: {
        // full_name, not the requested path: GitHub follows renames, and
        // recording where we actually landed keeps the link honest.
        repo: body.full_name ?? repo,
        stars,
        url: body.html_url ?? `https://github.com/${repo}`,
        repoAgeDays: Number.isNaN(createdMs)
          ? null
          : Math.floor((Date.now() - createdMs) / 86_400_000),
        archived: body.archived === true,
        fetchedAt: new Date().toISOString(),
      },
      // Stop before the floor so later runs in the same hour still work.
      rateLimited: Number.isFinite(remaining) && remaining <= RATE_LIMIT_FLOOR,
    };
  } catch (err) {
    log.warn("github repo lookup threw", { repo, error: err?.message ?? String(err) });
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    log.warn("github repo cache load failed", { error: err.message });
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    log.warn("github repo cache save failed", { error: err.message });
  }
}

// Exported only for unit tests.
export const __test__ = { applyCached, CACHE_TTL_MS, MAX_FETCHES_PER_RUN };
