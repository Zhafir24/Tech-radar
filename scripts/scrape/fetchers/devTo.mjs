/**
 * dev.to article fetcher — uses the public Forem API.
 * Docs: https://developers.forem.com/api/v1
 *
 * `top=N` returns the most-reactioned articles from the last N days.
 * We pull two windows (7 and 30 days) to blend recency with signal.
 */
import { fetchWithRetry } from "../http.mjs";
import { canonicalUrl, normalizeTags, stripHtml, toIsoDate } from "../normalize.mjs";
import { log } from "../logger.mjs";

const SOURCE_ID = "dev.to";

/** Terms that mark low-signal / non-technology content — dropped. */
const EXCLUDE_TAGS = new Set([
  "beginners",
  "career",
  "codenewbie",
  "meta",
  "watercooler",
  "showdev",
  "help",
  "productivity",
  "motivation",
  "healthydev",
]);

/** @returns {Promise<import("../normalize.mjs").Candidate[]>} */
export async function fetchDevTo() {
  const windows = [
    { top: 7, per_page: 60 },
    { top: 30, per_page: 40 },
  ];
  const bag = new Map();

  for (const win of windows) {
    const url = `https://dev.to/api/articles?top=${win.top}&per_page=${win.per_page}`;
    try {
      const articles = await fetchWithRetry(url, { parse: "json" });
      if (!Array.isArray(articles)) {
        log.warn("dev.to: non-array response", { url });
        continue;
      }
      for (const article of articles) {
        const candidate = adapt(article);
        if (candidate) bag.set(candidate.url, candidate);
      }
      log.info("dev.to fetched", { top: win.top, count: articles.length });
    } catch (err) {
      log.warn("dev.to fetch failed", { url, error: err.message });
    }
  }

  return [...bag.values()];
}

function adapt(article) {
  if (!article || typeof article !== "object") return null;
  const tags = normalizeTags(article.tag_list);
  if (tags.some((tag) => EXCLUDE_TAGS.has(tag))) return null;
  const url = canonicalUrl(article.canonical_url || article.url);
  if (!url) return null;

  return {
    source: SOURCE_ID,
    title: stripHtml(article.title ?? ""),
    url,
    summary: stripHtml(article.description ?? ""),
    tags,
    publishedAt: toIsoDate(article.published_at ?? article.published_timestamp),
    author: article.user?.name ?? null,
    raw: {
      positive_reactions: article.positive_reactions_count ?? 0,
      comments: article.comments_count ?? 0,
      reading_time: article.reading_time_minutes ?? null,
    },
  };
}
