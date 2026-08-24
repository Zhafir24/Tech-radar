/**
 * Sources config — the single source of truth for which sources the pipeline
 * actually runs. Managed by the "Manage sources" widget via
 * scripts/api/sources-api.mjs, consumed by scripts/scrape/index.mjs at
 * pipeline start.
 *
 * Shape:
 *   {
 *     builtIn: { [id]: { enabled: boolean } },   // fixed set of 5 known ids
 *     custom:  Array<{ id, name, url, enabled }> // user-added RSS/Atom feeds
 *   }
 *
 * Invariants:
 *   - Every built-in id is always present after load (fills in defaults).
 *   - At least one built-in must stay enabled — enforced by the API, not here.
 *   - Custom ids are deterministic hashes of the URL so remove/re-add of the
 *     same URL preserves any history keyed on the id.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONFIG_FILE = path.join("data", "sources-config.json");

const BUILT_IN_IDS = ["dev.to", "github-trending", "thehackernews", "infoq", "lobsters"];

const DEFAULT_CONFIG = {
  builtIn: Object.fromEntries(BUILT_IN_IDS.map((id) => [id, { enabled: true }])),
  custom: [],
};

export function loadSourcesConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return cloneDefault();
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return normalizeConfig(raw);
  } catch {
    return cloneDefault();
  }
}

export function saveSourcesConfig(config) {
  const normalized = normalizeConfig(config);
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function idForUrl(url) {
  return "custom-" + crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
}

export function isBuiltIn(id) {
  return BUILT_IN_IDS.includes(id);
}

export function listBuiltInIds() {
  return [...BUILT_IN_IDS];
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function normalizeConfig(raw) {
  const builtIn = {};
  for (const id of BUILT_IN_IDS) {
    const flag = raw?.builtIn?.[id];
    builtIn[id] = { enabled: flag?.enabled !== false };
  }
  const custom = Array.isArray(raw?.custom)
    ? raw.custom
        .filter(isValidCustom)
        .map((c) => ({
          id: String(c.id),
          name: String(c.name).trim(),
          url: String(c.url).trim(),
          enabled: c.enabled !== false,
        }))
    : [];
  return { builtIn, custom };
}

function isValidCustom(c) {
  return (
    c &&
    typeof c === "object" &&
    typeof c.id === "string" &&
    c.id.startsWith("custom-") &&
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    typeof c.url === "string" &&
    /^https?:\/\//i.test(c.url)
  );
}
