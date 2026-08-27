/**
 * "Any website" fetcher — used for every custom source added via the widget.
 *
 * Runs five tiers in order and returns the first non-empty result:
 *
 *   1. Direct fetch. If the URL already returns a feed (XML/RSS/Atom
 *      content-type OR the body looks like one), parse it as a feed.
 *
 *   2. Feed autodiscovery. If we got HTML, parse it and follow any
 *      <link rel="alternate" type="application/rss+xml" href="..."> pointer
 *      to the real feed URL, then re-attempt tier 1 on that URL.
 *
 *   3. Common feed paths. Try the well-known conventional locations off the
 *      origin (/rss, /feed, /rss.xml, /atom.xml, etc.) in case the site
 *      publishes a feed but doesn't advertise it via <link>.
 *
 *   4. HTML link scrape. Parse the initial HTML and pull out every <a>
 *      whose text looks article-shaped. Titles are the anchor text; the
 *      pipeline's taxonomy filter drops anything unrelated to tech.
 *
 *   5. Puppeteer real-browser render. If everything above returned nothing
 *      (site is behind Cloudflare bot-check, requires JS, or blocks
 *      non-browser UAs), spin up an actual Chrome tab, wait for the page
 *      to settle, then re-run tiers 2-4 against the rendered HTML.
 *
 * If tier 5 also yields nothing, we return []. The widget renders that
 * source amber with 0 items so the user knows their URL didn't yield
 * anything.
 */
import * as cheerio from "cheerio";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fetchRss } from "./rss.mjs";
import { canonicalUrl } from "../normalize.mjs";
import { log } from "../logger.mjs";
import { guardedFetch, validateExternalUrl } from "../url-guard.mjs";

const USER_AGENT =
  "Mozilla/5.0 (compatible; TechRadar/1.0; +https://example.invalid/radar)";

const COMMON_FEED_PATHS = [
  "/rss.xml",
  "/feed",
  "/feed.xml",
  "/rss",
  "/atom.xml",
  "/index.xml",
  "/feeds/all.atom.xml",
  "/blog/rss.xml",
  "/blog/feed",
];

// Anchor text shorter than this is almost always navigation — "Home",
// "Login", "About", etc. — never worth ingesting.
const MIN_ANCHOR_TEXT_LEN = 20;
const MAX_ANCHOR_TEXT_LEN = 200;
const MAX_HTML_SCRAPE_ITEMS = 100;

/**
 * @param {string} sourceId
 * @param {string} urlString
 * @returns {Promise<import("../normalize.mjs").Candidate[]>}
 */
export async function fetchWebsite(sourceId, urlString) {
  let root;
  try {
    root = new URL(urlString);
  } catch {
    log.warn(`${sourceId}: invalid URL, skipping`, { url: urlString });
    return [];
  }

  const initial = await tryFetch(root.toString());

  if (initial) {
    // Tier 1: URL is already a feed.
    if (initial.looksLikeFeed) {
      log.info(`${sourceId}: URL is a feed, parsing directly`);
      return await fetchRss(sourceId, root.toString());
    }

    if (initial.contentType.includes("html")) {
      // Tier 2: <link rel="alternate"> autodiscovery.
      const discovered = discoverFeedUrl(initial.body, root);
      if (discovered) {
        log.info(`${sourceId}: autodiscovered feed via <link>`, {
          feedUrl: discovered,
        });
        const items = await fetchRss(sourceId, discovered);
        if (items.length > 0) return items;
      }

      // Tier 3: Common feed paths off the origin.
      for (const path of COMMON_FEED_PATHS) {
        const candidate = new URL(path, root.origin + "/").toString();
        const probe = await tryFetch(candidate);
        if (probe?.looksLikeFeed) {
          log.info(`${sourceId}: feed found at conventional path`, { candidate });
          const items = await fetchRss(sourceId, candidate);
          if (items.length > 0) return items;
        }
      }

      // Tier 4: HTML link scrape.
      const scraped = scrapeHtmlLinks(sourceId, initial.body, root);
      if (scraped.length > 0) {
        log.info(`${sourceId}: HTML link scrape`, { count: scraped.length });
        return scraped;
      }
    } else {
      log.warn(`${sourceId}: unknown content type`, {
        contentType: initial.contentType,
      });
    }
  } else {
    // Cloudflare 403, network error, or similar — fall through to browser.
    log.warn(`${sourceId}: HTTP fetch was blocked, falling through to browser`, {
      url: root.toString(),
    });
  }

  // Tier 5: Puppeteer render — for sites that are behind Cloudflare, block
  // non-browser UAs, or ship an empty <div id="root"> and render everything
  // in JS. Slow (5-30s), only fires when everything else has failed.
  log.info(`${sourceId}: trying real-browser render`);
  return await fetchViaBrowser(sourceId, root);
}

async function fetchViaBrowser(sourceId, rootUrl) {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    log.warn(`${sourceId}: no Chrome/Edge found — cannot browser-render`);
    return [];
  }

  let browser;
  try {
    // puppeteer-extra + stealth plugin defeats most bot-detection fingerprints
    // (navigator.webdriver, chrome.runtime, plugin count, WebGL vendor, etc.).
    // Not a silver bullet — Cloudflare's Turnstile has other heuristics — but
    // it's the best chance short of a paid captcha-solving proxy.
    const puppeteer = (await import("puppeteer-extra")).default;
    const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(stealth());
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Give Cloudflare's challenge a real chance to resolve.
    await page.goto(rootUrl.toString(), {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Additional grace period in case the page mutates after networkidle.
    await new Promise((r) => setTimeout(r, 1500));

    // If we landed on a Cloudflare / DataDome / Akamai anti-bot challenge,
    // poll for up to 25s for it to auto-clear. Sometimes it does (the JS
    // solves the puzzle); often it doesn't when the browser is detected as
    // headless. We stop polling either way and let the caller see whatever
    // HTML is there.
    const CHALLENGE_TITLES = [
      "just a moment",
      "attention required",
      "please wait",
      "checking your browser",
      "one moment",
    ];
    const isChallengePage = async () => {
      const title = (await page.title()).toLowerCase();
      return CHALLENGE_TITLES.some((t) => title.includes(t));
    };
    if (await isChallengePage()) {
      log.info(`${sourceId}: anti-bot challenge detected, polling to clear`);
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!(await isChallengePage())) {
          log.info(`${sourceId}: challenge cleared`);
          break;
        }
      }
      if (await isChallengePage()) {
        log.warn(
          `${sourceId}: anti-bot challenge did not clear — site actively blocks automation`,
        );
      }
      // Extra settle time for the real page to render.
      await new Promise((r) => setTimeout(r, 2000));
    }

    const renderedHtml = await page.content();

    // Try feed autodiscovery + common paths again — the browser has real
    // cookies now, so those endpoints may work where the plain fetch didn't.
    const discovered = discoverFeedUrl(renderedHtml, rootUrl);
    if (discovered) {
      // Fetch the feed *through the browser* to inherit any Cloudflare cookies.
      const feedContent = await fetchThroughBrowser(page, discovered);
      if (feedContent && /<\s*(rss|feed|channel)\b/i.test(feedContent)) {
        log.info(`${sourceId}: browser tier autodiscovered feed`, { discovered });
        const items = await fetchRss(sourceId, discovered);
        if (items.length > 0) return items;
      }
    }

    // Fall back to HTML link scrape on the rendered DOM.
    const items = scrapeHtmlLinks(sourceId, renderedHtml, rootUrl);
    log.info(`${sourceId}: browser tier scraped links`, { count: items.length });
    return items;
  } catch (err) {
    log.warn(`${sourceId}: browser render failed`, {
      error: err?.message ?? String(err),
    });
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore browser-close errors — process is exiting soon anyway.
      }
    }
  }
}

async function fetchThroughBrowser(page, url) {
  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 15_000,
    });
    if (!response || !response.ok()) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Known install locations for a Chromium-family browser, per platform.
 * Ordered by preference: Chrome, then Chromium, then Edge, then Brave.
 */
function browserCandidates() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    // macOS ships apps as bundles; the real binary lives inside Contents/MacOS.
    // Both /Applications (system-wide) and ~/Applications (per-user) are valid
    // install targets, so check each.
    const bundles = [
      ["Google Chrome.app", "Google Chrome"],
      ["Google Chrome Canary.app", "Google Chrome Canary"],
      ["Chromium.app", "Chromium"],
      ["Microsoft Edge.app", "Microsoft Edge"],
      ["Brave Browser.app", "Brave Browser"],
    ];
    const roots = ["/Applications", nodePath.join(home, "Applications")];
    return roots.flatMap((root) =>
      bundles.map(([app, bin]) =>
        nodePath.join(root, app, "Contents", "MacOS", bin),
      ),
    );
  }

  if (process.platform === "win32") {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const relative = [
      ["Google", "Chrome", "Application", "chrome.exe"],
      ["Chromium", "Application", "chrome.exe"],
      ["Microsoft", "Edge", "Application", "msedge.exe"],
      ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
    ];
    return programFiles.flatMap((root) =>
      relative.map((parts) => nodePath.join(root, ...parts)),
    );
  }

  // Linux and other Unixes.
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/local/bin/chrome",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/var/lib/flatpak/exports/bin/com.google.Chrome",
    // What `npx puppeteer browsers install chrome` produces — often the only
    // browser on a headless Linux box.
    ...puppeteerCacheChromes(home),
  ];
}

/** Chrome builds under ~/.cache/puppeteer, newest-looking first. */
function puppeteerCacheChromes(home) {
  const root = nodePath.join(home, ".cache", "puppeteer", "chrome");
  try {
    return fs
      .readdirSync(root)
      .sort()
      .reverse()
      .map((dir) =>
        nodePath.join(root, dir, "chrome-linux64", "chrome"),
      );
  } catch {
    return [];
  }
}

/** Executable names to look for while walking PATH. */
function browserBinaryNames() {
  if (process.platform === "win32") {
    return ["chrome.exe", "msedge.exe", "brave.exe"];
  }
  return [
    "google-chrome",
    "google-chrome-stable",
    "chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
}

/** True when `file` exists and is executable — a same-named directory is not. */
function isExecutableFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a Chromium-family browser for the tier-5 browser render. puppeteer-core
 * deliberately does not bundle a browser, so it needs an explicit
 * executablePath.
 *
 * Resolution order:
 *   1. An explicit env override. PUPPETEER_EXECUTABLE_PATH is the convention
 *      puppeteer itself uses, so honour it as well as our own variable — this
 *      is the escape hatch when a browser lives somewhere unusual.
 *   2. Known per-platform install locations.
 *   3. A walk of PATH, which covers Homebrew, snap, nix, and other package
 *      managers that install outside the standard directories.
 *
 * Returns null when nothing is found; the caller logs a warning and skips the
 * browser tier rather than failing the whole scrape.
 */
function findChromeExecutable() {
  for (const key of [
    "CHROME_EXECUTABLE_PATH",
    "PUPPETEER_EXECUTABLE_PATH",
    "CHROME_PATH",
  ]) {
    const value = process.env[key];
    if (value && fs.existsSync(value)) return value;
  }

  for (const candidate of browserCandidates()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  const names = browserBinaryNames();
  for (const dir of (process.env.PATH ?? "").split(nodePath.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const full = nodePath.join(dir, name);
      // existsSync would also match a same-named directory.
      if (isExecutableFile(full)) return full;
    }
  }

  return null;
}

async function tryFetch(urlString) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await guardedFetch(urlString, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const body = await response.text();
    const sniff = body.slice(0, 512);
    const looksLikeFeed =
      contentType.includes("xml") ||
      contentType.includes("rss") ||
      contentType.includes("atom") ||
      /<\s*(rss|feed|channel)\b/i.test(sniff);
    return { contentType, body, looksLikeFeed };
  } catch {
    return null;
  }
}

function discoverFeedUrl(html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    const link = $(
      'link[rel="alternate"][type*="rss" i], link[rel="alternate"][type*="atom" i]',
    ).first();
    const href = link.attr("href");
    if (!href) return null;
    const resolved = new URL(href, baseUrl).toString();
    // The href comes from the page we just scraped, i.e. it is attacker
    // controlled. Without this check a hostile page could point us at
    // http://127.0.0.1/... and have the response ingested as radar content.
    if (validateExternalUrl(resolved).error) {
      log.warn("ignoring autodiscovered feed pointing at a non-public host", {
        feedUrl: resolved,
      });
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function scrapeHtmlLinks(sourceId, html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    const seen = new Set();
    const items = [];

    $("a[href]").each((_, el) => {
      if (items.length >= MAX_HTML_SCRAPE_ITEMS) return false;
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) return;

      // Prefer visible link text; fall back to aria-label/title if empty.
      let text = ($el.text() ?? "").replace(/\s+/g, " ").trim();
      if (!text) text = ($el.attr("aria-label") ?? "").trim();
      if (!text) text = ($el.attr("title") ?? "").trim();
      if (!text || text.length < MIN_ANCHOR_TEXT_LEN) return;

      let absolute;
      try {
        absolute = new URL(href, baseUrl).toString();
      } catch {
        return;
      }
      const canonical = canonicalUrl(absolute);
      if (!canonical) return;

      // Drop links that navigate to the same page (fragments, ".", etc.).
      const dest = new URL(canonical);
      if (dest.origin === baseUrl.origin && dest.pathname === baseUrl.pathname) return;
      if (seen.has(canonical)) return;
      seen.add(canonical);

      items.push({
        source: sourceId,
        title: text.slice(0, MAX_ANCHOR_TEXT_LEN),
        url: canonical,
        summary: "",
        tags: [],
        publishedAt: null,
        author: null,
        raw: { fallback: "html-scrape" },
      });
    });

    return items;
  } catch {
    return [];
  }
}
