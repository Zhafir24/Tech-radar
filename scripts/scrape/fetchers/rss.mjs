/**
 * Generic RSS/Atom fetcher used by The Hacker News and InfoQ.
 * Uses fast-xml-parser (no additional deps).
 */
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "../http.mjs";
import {
  canonicalUrl,
  normalizeTags,
  stripHtml,
  toIsoDate,
} from "../normalize.mjs";
import { log } from "../logger.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) => ["item", "entry", "category"].includes(name),
});

/**
 * @param {string} sourceId
 * @param {string} url
 * @returns {Promise<import("../normalize.mjs").Candidate[]>}
 */
export async function fetchRss(sourceId, url) {
  let xml;
  try {
    xml = await fetchWithRetry(url, { parse: "text", retries: 3 });
  } catch (err) {
    log.warn(`${sourceId} fetch failed`, { url, error: err.message });
    return [];
  }

  let feed;
  try {
    feed = parser.parse(xml);
  } catch (err) {
    log.warn(`${sourceId} parse failed`, { error: err.message });
    return [];
  }

  const items = extractItems(feed);
  const candidates = items.map((item) => adaptItem(sourceId, item)).filter(Boolean);
  log.info(`${sourceId} fetched`, { count: candidates.length });
  return candidates;
}

function extractItems(feed) {
  return (
    feed?.rss?.channel?.item ??
    feed?.feed?.entry ??
    feed?.channel?.item ??
    []
  );
}

function adaptItem(sourceId, item) {
  const title = stripHtml(item.title?.["#text"] ?? item.title ?? "");
  if (!title) return null;

  const url = canonicalUrl(pickLink(item.link));
  if (!url) return null;

  const description = stripHtml(
    item.description?.["#text"] ??
      item.description ??
      item.summary?.["#text"] ??
      item.summary ??
      item.content?.["#text"] ??
      item.content ??
      "",
  );

  const publishedAt = toIsoDate(
    item.pubDate ?? item.published ?? item.updated ?? null,
  );

  const categoryValues = (item.category ?? []).map((cat) =>
    typeof cat === "string" ? cat : (cat?.["#text"] ?? ""),
  );

  return {
    source: sourceId,
    title,
    url,
    summary: description.slice(0, 500),
    tags: normalizeTags(categoryValues),
    publishedAt,
    author:
      item["dc:creator"] ??
      item.author?.name ??
      (typeof item.author === "string" ? item.author : null),
    raw: {},
  };
}

/**
 * Extract a usable URL from RSS/Atom's `<link>` element, which has four
 * shapes in the wild: plain string, `{ "@_href": ... }` object, an array of
 * plain strings (RSS 2.0 with multiple links), or an array of objects (Atom
 * `<link rel="self">` + `<link rel="alternate">`). Returns "" if nothing.
 */
function pickLink(link) {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    for (const entry of link) {
      const candidate = typeof entry === "string" ? entry
        : entry?.["@_href"] ?? entry?.["#text"] ?? "";
      if (candidate) return String(candidate);
    }
    return "";
  }
  return String(link?.["@_href"] ?? link?.["#text"] ?? "");
}

/*
 * Source IDs deliberately match the ones used in scripts/scrape/index.mjs's
 * `sources` array so a single string identifies a source everywhere in the
 * pipeline (SOURCE_DISPLAY_NAMES, shortSource(), diagnostics, tests).
 */
export function fetchHackerNews() {
  return fetchRss("thehackernews", "https://feeds.feedburner.com/TheHackersNews");
}

export function fetchInfoQ() {
  return fetchRss("infoq", "https://feed.infoq.com/");
}
