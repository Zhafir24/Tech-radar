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
import net from "node:net";
import {
  loadSourcesConfig,
  saveSourcesConfig,
  idForUrl,
  isBuiltIn,
} from "../scrape/config.mjs";

const scrapeState = {
  running: false,
  lastExitCode: null,
  lastError: null,
  tail: [],
  startedAt: null,
  finishedAt: null,
};

const MAX_TAIL_LINES = 60;

export async function handleSourcesApi(req, res) {
  try {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsed.pathname;
    const method = req.method ?? "GET";

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
  const before = config.custom.length;
  config.custom = config.custom.filter((c) => c.id !== id);
  if (config.custom.length === before) return json(res, 404, { error: "not found" });
  saveSourcesConfig(config);
  return json(res, 200, { deleted: id });
}

async function toggleSource(req, res, id) {
  const body = await readJson(req);
  if (body.error) return json(res, 400, { error: body.error });
  const enabled = body.value?.enabled !== false;

  const config = loadSourcesConfig();

  if (isBuiltIn(id)) {
    if (!enabled) {
      const remaining = Object.entries(config.builtIn).filter(
        ([otherId, v]) => otherId !== id && v.enabled !== false,
      ).length;
      const anyCustomActive = config.custom.some((c) => c.enabled !== false);
      if (remaining === 0 && !anyCustomActive) {
        return json(res, 400, {
          error:
            "cannot disable the last active source — enable another one first",
        });
      }
    }
    config.builtIn[id] = { enabled };
  } else {
    const found = config.custom.find((c) => c.id === id);
    if (!found) return json(res, 404, { error: "not found" });
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
  child.on("exit", (code) => {
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

/**
 * Reject any URL that would let a user turn the scraper into an SSRF vector
 * (internal services, cloud metadata, loopback). We check the hostname
 * literally *and* — if it's an IP — whether it falls in a private range.
 */
function validateExternalUrl(input) {
  if (!input) return { error: "url is required" };
  if (input.length > 500) return { error: "url is too long" };

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { error: "invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { error: "URL must use http or https" };
  }

  // WHATWG URL returns IPv6 literals wrapped in brackets ("[::1]"), which
  // neither net.isIP() nor the literal comparisons below would ever match.
  // Strip them or the whole IPv6 half of this guard is dead code.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { error: "URL points to a local/internal host — not allowed" };
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return { error: "URL points to a private IP range — not allowed" };
    }
  }
  return { ok: true };
}

function isPrivateIp(host) {
  if (net.isIPv4(host)) {
    const p = host.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 0) return true;
    return false;
  }
  // IPv6: loopback and unique-local ranges.
  if (host === "::1" || host === "::") return true;
  if (/^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) reaches the same host as the bare IPv4
  // address, so judge it by the address it maps to. Node normalises the dotted
  // form to hex pairs (::ffff:7f00:1), so accept both spellings.
  const mapped = /^::ffff:(.+)$/i.exec(host);
  if (mapped) {
    const tail = mapped[1];
    if (net.isIPv4(tail)) return isPrivateIp(tail);
    const pair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (pair) {
      const high = parseInt(pair[1], 16);
      const low = parseInt(pair[2], 16);
      const dotted = [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
      ].join(".");
      return isPrivateIp(dotted);
    }
  }
  return false;
}
