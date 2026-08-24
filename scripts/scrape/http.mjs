/**
 * HTTP helper: retry with exponential backoff, timeout, sensible headers.
 */

const DEFAULT_UA =
  "PNM-Tech-Radar-Scraper/1.0 (+https://example.invalid/radar; contact@example.invalid)";

/**
 * @param {string} url
 * @param {object} [options]
 * @param {"json"|"text"} [options.parse="text"]
 * @param {number} [options.timeoutMs=15000]
 * @param {number} [options.retries=2]
 * @param {Record<string,string>} [options.headers]
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    parse = "text",
    timeoutMs = 15000,
    retries = 2,
    headers = {},
  } = options;

  const accept =
    parse === "json"
      ? "application/json"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  const finalHeaders = {
    "User-Agent": DEFAULT_UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    ...headers,
  };

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: finalHeaders,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (response.ok) {
        return parse === "json" ? await response.json() : await response.text();
      }

      // 4xx — permanent, do not retry. 5xx / network — retry if attempts remain.
      const err = new Error(
        `HTTP ${response.status} ${response.statusText} for ${url}`,
      );
      err.status = response.status;
      err.permanent = response.status >= 400 && response.status < 500;
      throw err;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // Bail out on permanent failures (4xx) OR when we've exhausted retries.
      if (err?.permanent || attempt >= retries) throw err;
    }

    attempt++;
    // Exponential backoff: 500 ms, 1.5 s, 3.5 s, …
    const delayMs = 500 * Math.pow(3, attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw lastError ?? new Error(`Fetch failed for ${url}`);
}
