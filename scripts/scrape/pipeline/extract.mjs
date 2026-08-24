/**
 * Extract technology mentions from candidates.
 *
 * A "mention" says: this technology was referenced in this candidate on
 * this date. Multiple candidates → multiple mentions → cross-source
 * evidence for scoring & dedup.
 *
 * For github-trending candidates the technology is the repo itself:
 * we look up the repo name (and stem/normalizations) in the taxonomy. If
 * no taxonomy match, the repo is dropped (see "Never guess. Classification
 * must be explainable." in the criteria).
 *
 * For article candidates (dev.to / HN / InfoQ / Lobste.rs) we search
 * title + summary + tags with the master alias regex.
 */
import {
  ALIAS_REGEX,
  ALIAS_TO_SLUG,
  SLUG_TO_ENTRY,
} from "../taxonomy.mjs";

/**
 * @typedef {Object} Mention
 * @property {string} slug
 * @property {string} source
 * @property {string} url
 * @property {string} title
 * @property {string|null} publishedAt
 * @property {object} raw
 */

/** Build a searchable string from a candidate. Defensive on missing fields. */
function haystackFor(candidate) {
  const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
  return [candidate.title, candidate.summary, tags.join(" ")]
    .filter((s) => typeof s === "string" && s)
    .join(" ");
}

/** Distinct slugs the master alias regex finds in `text`. */
function slugsIn(text) {
  const seen = new Set();
  if (!text) return seen;
  // Fresh iterator each call — never touches ALIAS_REGEX.lastIndex, so this
  // is safe if callers ever run in parallel (defensive).
  for (const match of text.matchAll(ALIAS_REGEX)) {
    const slug = ALIAS_TO_SLUG.get(match[0].toLowerCase());
    if (slug) seen.add(slug);
  }
  return seen;
}

/**
 * @param {import("../normalize.mjs").Candidate[]} candidates
 * @returns {Mention[]}
 */
export function extractMentions(candidates) {
  const mentions = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    if (candidate.source === "github-trending") {
      const slug = matchGitHubRepo(candidate);
      if (slug) mentions.push(toMention(slug, candidate));
      continue;
    }

    for (const slug of slugsIn(haystackFor(candidate))) {
      mentions.push(toMention(slug, candidate));
    }
  }

  return mentions;
}

function matchGitHubRepo(candidate) {
  const slugs = [...slugsIn(haystackFor(candidate))];
  if (slugs.length === 0) return null;

  // Prefer taxonomy entries that share a name substring with the repo —
  // this favors "kubernetes" over "docker" when the repo is "kubernetes/kubernetes".
  const repo = String(candidate.raw?.repo ?? "").toLowerCase();
  return slugs
    .map((slug) => {
      const entry = SLUG_TO_ENTRY.get(slug);
      const nameMatch = entry?.name.toLowerCase() === repo ? 3 : 0;
      const aliasMatch = entry?.aliases.some((a) => a === repo) ? 2 : 0;
      return { slug, score: nameMatch + aliasMatch };
    })
    .sort((a, b) => b.score - a.score)[0].slug;
}

function toMention(slug, candidate) {
  return {
    slug,
    source: candidate.source,
    url: candidate.url,
    title: candidate.title,
    publishedAt: candidate.publishedAt ?? null,
    raw: candidate.raw ?? {},
  };
}
