/**
 * Local-only HTTP API for the "Manage sources" widget. Mounted into the Vite
 * dev server by vite.config.ts — there is no separate process. The Vite dev
 * server binds to 127.0.0.1 via scripts/serve.mjs, so this API is not
 * reachable from the network.
 *
 * Endpoints:
 *   GET    /api/sources                → { builtIn, custom }
 *   POST   /api/sources                body {name,url}      → adds a custom RSS
 *   DELETE /api/sources/:id            → removes a custom source
 *   POST   /api/sources/:id/toggle     body {enabled:bool}  → enable/disable
 *   POST   /api/scrape                 → run `npm run scrape` if idle
 *   GET    /api/scrape                 → { running, lastExitCode, lastError, tail[] }
 *
 * SSRF: URLs are constrained to http/https and cannot target loopback/private
 * ranges. This is important because the scraper runs on the same host and can
 * reach internal services.
 */
import { spawn } from "node:child_process";
import {
  loadSourcesConfig,
  saveSourcesConfig,
  idForUrl,
  isBuiltIn,
} from "../scrape/config.mjs";
import { validateExternalUrl } from "../scrape/url-guard.mjs";

const scrapeState = {
  running: false,
  lastExitCode: null,
  lastError: null,
  tail: [],
  startedAt: null,
  finishedAt: null,
};

const MAX_TAIL_LINES = 60;

/**
 * Reject cross-site state-changing requests.
 *
 * This API has no auth — it trusts that only the local radar page calls it.
 * But a browser will happily send a cross-origin POST from any page the user
 * happens to be visiting, and a text/plain body is CORS-safelisted so there is
 * no preflight to stop it. Without this check, any website could add scrape
 * sources or start scrapes on the user's machine.
 */
function isCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // Same-origin fetch/XHR omits Origin for GET; non-browser clients too.
  try {
    return new URL(origin).hostname !== "localhost" &&
      new URL(origin).hostname !== "127.0.0.1" &&
      new URL(origin).hostname !== "[::1]" &&
      new URL(origin).hostname !== "::1";
  } catch {
    return true;
  }
}

export async function handleSourcesApi(req, res) {
  try {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsed.pathname;
    const method = req.method ?? "GET";

    if (method !== "GET" && isCrossSite(req)) {
      return json(res, 403, {
        error: "cross-site request refused",
      });
    }

    if (pathname === "/api/sources" && method === "GET") {
      return json(res, 200, loadSourcesConfig());
    }
    if (pathname === "/api/sources" && method === "POST") {
      return await addSource(req, res);
    }
    if (pathname === "/api/scrape" && method === "GET") {
      return json(res, 200, scrapeState);
    }
    if (pathname === "/api/scrape" && method === "POST") {
      return startScrape(res);
    }

    const deleteMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") {
      return deleteSource(res, decodeURIComponent(deleteMatch[1]));
    }
    const toggleMatch = pathname.match(/^\/api\/sources\/([^/]+)\/toggle$/);
    if (toggleMatch && method === "POST") {
      return await toggleSource(req, res, decodeURIComponent(toggleMatch[1]));
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err?.message ?? String(err) });
  }
}

/* ────────────────────────── handlers ─────────────────────────── */

async function addSource(req, res) {
  const body = await readJson(req);
  if (body.error) return json(res, 400, { error: body.error });

  let name = String(body.value?.name ?? "").trim();
  const rawUrl = String(body.value?.url ?? "").trim();
  if (!rawUrl) return json(res, 400, { error: "URL is required" });
  if (name.length > 60) return json(res, 400, { error: "name is too long (max 60 chars)" });

  // Newbie-friendly: accept "hashnode.com" and turn it into "https://hashnode.com".
  const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const validation = validateExternalUrl(normalizedUrl);
  if (validation.error) return json(res, 400, { error: validation.error });

  // Name is optional — if the user didn't supply one, derive it from the
  // URL's hostname (e.g. "arstechnica.com").
  if (!name) {
    try {
      name = new URL(normalizedUrl).hostname.replace(/^www\./i, "");
    } catch {
      name = normalizedUrl;
    }
  }

  const config = loadSourcesConfig();
  const id = idForUrl(normalizedUrl);
  if (config.custom.some((c) => c.id === id)) {
    return json(res, 409, { error: "this URL is already added" });
  }
  config.custom.push({ id, name, url: normalizedUrl, enabled: true });
  saveSourcesConfig(config);
  return json(res, 200, { id, name, url: normalizedUrl, enabled: true });
}

function deleteSource(res, id) {
  if (isBuiltIn(id)) {
    return json(res, 400, {
      error: "cannot delete a built-in source — toggle it off instead",
    });
  }
  const config = loadSourcesConfig();
  if (!config.custom.some((c) => c.id === id)) {
    return json(res, 404, { error: "not found" });
  }
  // Deleting can strand the radar with no source just as disabling can.
  if (activeCountAfter(config, id, null) === 0) {
    return json(res, 400, {
      error: "cannot remove the last active source — enable another one first",
    });
  }
  config.custom = config.custom.filter((c) => c.id !== id);
  saveSourcesConfig(config);
  return json(res, 200, { deleted: id });
}

/**
 * How many sources would still be active after a proposed change.
 *
 * `changedId` is the source being toggled or removed; pass `enabled: null` to
 * count it as deleted. Covers built-ins AND customs — the previous guard only
 * looked at built-ins, so disabling the last custom source dropped the count
 * to zero and left the radar with no source at all.
 */
function activeCountAfter(config, changedId, enabled) {
  let active = 0;
  for (const [id, value] of Object.entries(config.builtIn)) {
    const on = id === changedId ? enabled === true : value.enabled !== false;
    if (on) active++;
  }
  for (const custom of config.custom) {
    if (custom.id === changedId) {
      if (enabled === true) active++;
      continue;
    }
    if (custom.enabled !== false) active++;
  }
  return active;
}

async function toggleSource(req, res, id) {
  const body = await readJson(req);
  if (body.error) return json(res, 400, { error: body.error });
  const enabled = body.value?.enabled !== false;

  const config = loadSourcesConfig();

  if (!isBuiltIn(id) && !config.custom.some((c) => c.id === id)) {
    return json(res, 404, { error: "not found" });
  }

  if (!enabled && activeCountAfter(config, id, false) === 0) {
    return json(res, 400, {
      error: "cannot disable the last active source — enable another one first",
    });
  }

  if (isBuiltIn(id)) {
    config.builtIn[id] = { enabled };
  } else {
    const found = config.custom.find((c) => c.id === id);
    found.enabled = enabled;
  }
  saveSourcesConfig(config);
  return json(res, 200, { id, enabled });
}

function startScrape(res) {
  if (scrapeState.running) {
    return json(res, 409, { error: "scrape already running", ...scrapeState });
  }
  scrapeState.running = true;
  scrapeState.lastExitCode = null;
  scrapeState.lastError = null;
  scrapeState.tail = [];
  scrapeState.startedAt = new Date().toISOString();
  scrapeState.finishedAt = null;

  // On Windows, npm resolves to npm.cmd — spawning .cmd/.bat without a shell
  // is blocked by Node ≥20 for security reasons and returns spawn EINVAL.
  // Using shell:true on Windows only is safe here because our own args list
  // is fixed and contains no user-controlled data.
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  let child;
  try {
    child = spawn(cmd, ["run", "scrape"], {
      cwd: process.cwd(),
      shell: isWin,
      windowsHide: true,
    });
  } catch (err) {
    scrapeState.running = false;
    scrapeState.lastError = err?.message ?? String(err);
    return json(res, 500, { error: scrapeState.lastError });
  }

  const append = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      scrapeState.tail.push(line);
      if (scrapeState.tail.length > MAX_TAIL_LINES) scrapeState.tail.shift();
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (err) => {
    scrapeState.lastError = err?.message ?? String(err);
  });
  // Reset on "close", not "exit". A failed spawn (npm missing from PATH — the
  // normal case on macOS under nvm/Homebrew when the editor launched the dev
  // server) emits "error" and "close" but NEVER "exit", so resetting only in
  // "exit" left running=true forever and every later rescrape returned 409.
  child.on("close", (code) => {
    scrapeState.running = false;
    scrapeState.lastExitCode = code;
    scrapeState.finishedAt = new Date().toISOString();
  });

  return json(res, 202, { started: true, startedAt: scrapeState.startedAt });
}

/* ────────────────────────── helpers ─────────────────────────── */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      // Reject bodies larger than 32 KB to protect the local process.
      if (size > 32 * 1024) {
        req.destroy();
        resolve({ error: "request body too large" });
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({ value: {} });
      try {
        resolve({ value: JSON.parse(raw) });
      } catch {
        resolve({ error: "invalid JSON body" });
      }
    });
    req.on("error", () => resolve({ error: "request stream error" }));
  });
}


