/**
 * Normalization primitives — used by every source adapter so downstream
 * dedup and matching work on a single canonical shape.
 */

/**
 * @typedef {Object} Candidate
 * @property {string} source          Origin site id (e.g. "github-trending").
 * @property {string} title           Human-readable headline / repo name.
 * @property {string} url             Canonical URL (redirects resolved).
 * @property {string} summary         Plain-text description, HTML stripped.
 * @property {string[]} tags          Lowercase, deduped, trimmed keywords.
 * @property {string|null} publishedAt ISO 8601 publish date, or null.
 * @property {string|null} author     Optional author / owner.
 * @property {object} raw             Source-specific extras (github stars, etc.).
 */

/** Remove HTML tags + collapse whitespace to a single line. */
export function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coerce a date-ish input into an ISO 8601 string, or null. */
export function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Coerce a URL into its canonical form. Returns "" for anything that isn't
 * a syntactically valid HTTP(S) URL — this drops `javascript:`, `data:`,
 * `file:`, mailto/tel schemes, and unparseable strings, all of which are
 * useless (or unsafe) as blip references.
 */
export function canonicalUrl(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }
  if (!SAFE_URL_PROTOCOLS.has(url.protocol)) return "";
  // Drop common tracking parameters.
  for (const param of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(param) || param === "ref") url.searchParams.delete(param);
  }
  url.hash = "";
  return url.toString();
}

/** Deduplicate a list of tag strings, trimmed and lowercased. */
export function normalizeTags(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set();
  for (const tag of list) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().toLowerCase();
    if (trimmed) set.add(trimmed);
  }
  return [...set];
}
