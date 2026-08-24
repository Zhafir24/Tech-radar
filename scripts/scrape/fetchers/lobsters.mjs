/**
 * Lobste.rs fetcher — replaces the daily.dev stub.
 *
 * Lobste.rs publishes first-class JSON feeds at `/hottest.json` and
 * `/newest.json`; each response is a straight array of story objects. No
 * scraping fragility, no auth. We pull both windows and dedupe by URL —
 * "hottest" gives strong signal, "newest" catches emerging items.
 *
 * Story shape (documented at https://lobste.rs):
 *   {
 *     short_id, short_id_url, created_at, title,
 *     url,                       // outbound link — may be "" for text posts
 *     score, comment_count,
 *     description, description_plain,
 *     tags,                      // array of tag slugs, tech-focused
 *     submitter_user
 *   }
 */
import { fetchWithRetry } from "../http.mjs";
import {
  canonicalUrl,
  normalizeTags,
  stripHtml,
  toIsoDate,
} from "../normalize.mjs";
import { log } from "../logger.mjs";

const SOURCE_ID = "lobsters";

/** Tag slugs that mark non-tech / meta content — dropped. */
const EXCLUDE_TAGS = new Set(["meta", "ask", "job", "book", "video"]);

/** @returns {Promise<import("../normalize.mjs").Candidate[]>} */
export async function fetchLobsters() {
  const feeds = [
    "https://lobste.rs/hottest.json",
    "https://lobste.rs/newest.json",
  ];
  const bag = new Map();

  for (const url of feeds) {
    try {
      const stories = await fetchWithRetry(url, { parse: "json", retries: 3 });
      if (!Array.isArray(stories)) {
        log.warn("lobsters: non-array response", { url });
        continue;
      }
      for (const story of stories) {
        const candidate = adapt(story);
        if (candidate) bag.set(candidate.url, candidate);
      }
      log.info("lobsters fetched", { feed: url.split("/").pop(), count: stories.length });
    } catch (err) {
      log.warn("lobsters fetch failed", { url, error: err.message });
    }
  }

  return [...bag.values()];
}

function adapt(story) {
  if (!story || typeof story !== "object") return null;

  const tags = normalizeTags(story.tags);
  if (tags.some((tag) => EXCLUDE_TAGS.has(tag))) return null;

  // Prefer the outbound article URL; fall back to the Lobste.rs thread page
  // for self-posts (which have url === "").
  const outbound = typeof story.url === "string" && story.url.trim() ? story.url : "";
  const thread = story.short_id_url || story.comments_url || "";
  const url = canonicalUrl(outbound || thread);
  if (!url) return null;

  const title = stripHtml(story.title ?? "");
  if (!title) return null;

  return {
    source: SOURCE_ID,
    title,
    url,
    summary: stripHtml(story.description_plain ?? story.description ?? ""),
    tags,
    publishedAt: toIsoDate(story.created_at),
    author: story.submitter_user ?? null,
    raw: {
      score: story.score ?? 0,
      comments: story.comment_count ?? 0,
    },
  };
}
