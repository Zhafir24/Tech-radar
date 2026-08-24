/**
 * GitHub Trending fetcher.
 *
 * There is no official GitHub Trending API, so this scrapes the HTML at
 * https://github.com/trending. We pull three windows (daily, weekly,
 * monthly) and use the `.Box-row` structure that has been stable for years.
 */
import * as cheerio from "cheerio";
import { fetchWithRetry } from "../http.mjs";
import { canonicalUrl, normalizeTags, stripHtml, toIsoDate } from "../normalize.mjs";
import { log } from "../logger.mjs";

const SOURCE_ID = "github-trending";

/** @returns {Promise<import("../normalize.mjs").Candidate[]>} */
export async function fetchGitHubTrending() {
  const windows = ["daily", "weekly", "monthly"];
  const bag = new Map();

  for (const since of windows) {
    const url = `https://github.com/trending?since=${since}&spoken_language_code=en`;
    try {
      const html = await fetchWithRetry(url, { parse: "text", retries: 3 });
      const rows = parseTrending(html, since);
      for (const row of rows) bag.set(row.url, row);
      log.info("github trending fetched", { since, count: rows.length });
    } catch (err) {
      log.warn("github trending fetch failed", { since, error: err.message });
    }
  }

  return [...bag.values()];
}

function parseTrending(html, sincePeriod) {
  const $ = cheerio.load(html);
  const results = [];

  $("article.Box-row").each((_, article) => {
    const $article = $(article);

    // "owner / repo" — the anchor text has newlines and whitespace.
    const anchor = $article.find("h2 a").first();
    const path = (anchor.attr("href") || "").trim();
    if (!path || !path.startsWith("/")) return;
    const [owner, repo] = path.slice(1).split("/");
    if (!owner || !repo) return;

    const description = stripHtml($article.find("p").first().text());
    const language = $article.find('[itemprop="programmingLanguage"]').first().text().trim() || null;

    // Star count is the first anchor pointing at ".../stargazers".
    const totalStars = parseNumber(
      $article.find(`a[href="${path}/stargazers"]`).first().text(),
    );
    // Forks are the anchor to ".../forks".
    const forks = parseNumber(
      $article.find(`a[href="${path}/forks"]`).first().text(),
    );
    // "1,234 stars today" — extract the number for the current window.
    const starsTodayText = $article.find(".d-inline-block.float-sm-right").text();
    const starsInWindow = parseNumber(starsTodayText);

    const url = `https://github.com${path}`;

    results.push({
      source: SOURCE_ID,
      title: `${owner}/${repo}`,
      url: canonicalUrl(url),
      summary: description,
      tags: normalizeTags([repo, language ?? ""].filter(Boolean)),
      publishedAt: toIsoDate(new Date()),
      author: owner,
      raw: {
        owner,
        repo,
        language,
        stars: totalStars,
        forks,
        stars_in_window: starsInWindow,
        trending_window: sincePeriod,
      },
    });
  });

  return results;
}

function parseNumber(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[,\s]/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)([kmb]?)/i);
  if (!match) return 0;
  const [, num, suffix] = match;
  const mult = suffix?.toLowerCase() === "k" ? 1000 : suffix?.toLowerCase() === "m" ? 1_000_000 : suffix?.toLowerCase() === "b" ? 1_000_000_000 : 1;
  return Math.round(parseFloat(num) * mult);
}
