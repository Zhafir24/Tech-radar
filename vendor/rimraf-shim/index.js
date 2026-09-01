'use strict'

/**
 * rimraf-shim — a local, zero-dependency stand-in for `rimraf@3`.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `npm install` used to print three deprecation warnings, all from a single
 * transitive chain with a single entry point:
 *
 *   puppeteer-extra-plugin-stealth@2.11.2
 *     -> puppeteer-extra-plugin-user-preferences@2.4.1
 *       -> puppeteer-extra-plugin-user-data-dir@2.4.1
 *         -> rimraf@3.0.2      "Rimraf versions prior to v4 are no longer supported"
 *           -> glob@7.2.3      "Old versions of glob ... security vulnerabilities"
 *             -> inflight@1.0.6  "not supported, and leaks memory"
 *
 * We cannot fix this upstream. The puppeteer-extra monorepo's last release was
 * 2023-03-01; `puppeteer-extra-plugin-stealth@2.11.2` is still the newest
 * publish, so no version bump of ours will ever pull in a repaired tree.
 *
 * Every version-bump route was tested empirically and every one of them breaks
 * the plugin's profile cleanup:
 *
 *   - rimraf 5 / 6 export an object, not a function. The consumer does
 *     `const rimraf = require('rimraf')` and then calls it, so this dies with
 *     `TypeError: rimraf is not a function` and the temp profile is never
 *     deleted.
 *   - rimraf 4.4.1 IS callable and does delete, but it silently ignores the
 *     third (callback) argument and turns failures into unhandled promise
 *     rejections. The scraper installs no `unhandledRejection` handler, so a
 *     locked profile file would take the whole run down.
 *   - Overriding only `glob` does not help: every `glob` up to and including
 *     v11 carries its own deprecation notice, and v12/v13 dropped the callback
 *     API that rimraf@3 is written against.
 *   - Importing stealth evasions selectively does not help either: npm resolves
 *     the `dependencies` block of each package, not the actual import graph.
 *
 * So we vendor the ~30 lines of rimraf@3 API that are actually used and point
 * an npm `override` at this directory (see the repo's package.json). Node's
 * native `fs.rm` has done recursive deletion since v14, which makes glob and
 * inflight unnecessary — after this change they are absent from `node_modules`
 * entirely and all three warnings are gone.
 *
 * ── HOW IT IS WIRED, AND THE TRAP TO AVOID ──────────────────────────────────
 *
 * package.json carries BOTH halves, and both are required:
 *
 *   "dependencies": { "rimraf": "file:./vendor/rimraf-shim" }
 *   "overrides":    { "rimraf": "$rimraf" }
 *
 * `$rimraf` tells npm "use the spec from this project's own dependencies".
 * Do NOT collapse it to the obvious one-liner:
 *
 *   "overrides": { "rimraf": "file:./vendor/rimraf-shim" }   // BROKEN
 *
 * That form installs and looks fine, but npm resolves the relative `file:`
 * path against the OVERRIDDEN package rather than the project root. It writes a
 * lockfile entry pointing at the non-existent
 * `node_modules/puppeteer-extra-plugin-user-data-dir/vendor/rimraf-shim`, with
 * no name or version, and the next `npm ci` dies with:
 *
 *   npm error `npm ci` can only install packages when your package.json and
 *   package-lock.json ... are in sync.
 *   npm error Missing: rimraf@ from lock file
 *
 * The two-part form above resolves from the root, so the lockfile records
 * `"vendor/rimraf-shim": { "name": "rimraf", "version": "3.0.2" }` and both
 * `npm install` and `npm ci` work from a clean clone. That is also why this
 * directory must stay committed: it is a real dependency path now, and a clone
 * missing it cannot install.
 *
 * ── THE ONLY CONSUMER ───────────────────────────────────────────────────────
 *
 * `node_modules/puppeteer-extra-plugin-user-data-dir/index.js`, which deletes
 * the throwaway Chrome profile after a scrape:
 *
 *   const rimraf = require('rimraf')
 *   rimraf(this._userDataDir, { maxBusyTries: 4 }, err => { debug(err) })
 *
 * `npm ls rimraf` confirms it is the sole node in the tree that depends on
 * rimraf at runtime. Two consequences follow, and both are load-bearing:
 *
 *   1. This function MUST NEVER THROW SYNCHRONOUSLY. The call above is not
 *      wrapped in try/catch, and the callback only logs. `fs.rm` validates its
 *      arguments synchronously and throws rather than routing to the callback
 *      (e.g. `TypeError [ERR_INVALID_ARG_VALUE]` for a path containing a null
 *      byte), which would abort the scrape with exit code 1. Every error,
 *      argument-validation errors included, is therefore delivered to the
 *      callback on a later tick so the contract is uniform.
 *   2. `maxBusyTries` must keep working. On Windows, Chrome holds locks on
 *      profile files for a moment after exit; dropping the retry behaviour
 *      would strand `puppeteer_dev_profile-*` directories in the temp folder
 *      on every run. It maps onto `fs.rm`'s `maxRetries`.
 *
 * ── DELIBERATE OMISSION ─────────────────────────────────────────────────────
 *
 * rimraf@3 expanded glob patterns by default. That feature is the entire reason
 * `glob` and `inflight` were in the tree, and no consumer here passes a
 * pattern — only literal paths from `fs.mkdtemp`. Globbing is intentionally not
 * implemented. rimraf@3's `bin.js` CLI is likewise not reproduced; nothing in
 * this repo or its dependency tree invokes it.
 *
 * ── LICENSING ───────────────────────────────────────────────────────────────
 *
 * This is original code written for this repository and released under the same
 * MIT licence as the rest of it. No source was copied from the rimraf project;
 * only rimraf@3's public API shape is reproduced, which is what the consumer
 * above calls against.
 */

const fs = require('fs')

/** rimraf@3's own default when `maxBusyTries` is not supplied. */
const DEFAULT_MAX_BUSY_TRIES = 3

const NOOP = () => {}

/**
 * The consumer may pass no callback at all. Returning a no-op keeps the "never
 * throw" promise instead of blowing up on `callback is not a function`.
 */
function toCallback(callback) {
  return typeof callback === 'function' ? callback : NOOP
}

/**
 * Translate rimraf@3 options into `fs.rm` options.
 *
 * `recursive` + `force` together reproduce rimraf@3's headline behaviour: it
 * removes directory trees, and a path that does not exist is a success, not an
 * error. A non-integer or negative `maxBusyTries` falls back to the default
 * rather than reaching `fs.rm` and being rejected as an invalid argument.
 */
function toRmOptions(options) {
  const source = options && typeof options === 'object' ? options : {}
  const tries = source.maxBusyTries
  const maxRetries =
    Number.isInteger(tries) && tries >= 0 ? tries : DEFAULT_MAX_BUSY_TRIES
  return { recursive: true, force: true, maxRetries }
}

/**
 * Recursively delete `path`.
 *
 * Accepts `rimraf(path, options, callback)`, `rimraf(path, callback)`, and
 * `rimraf(path)`. Calls back exactly once with `null` on success or an `Error`
 * on failure. Never throws.
 *
 * @param {string|Buffer|URL} path
 * @param {{maxBusyTries?: number}|Function} [options]
 * @param {(err: Error|null) => void} [callback]
 * @returns {void}
 */
function rimraf(path, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = undefined
  }

  const done = toCallback(callback)
  let settled = false
  const settle = (err) => {
    if (settled) return
    settled = true
    done(err || null)
  }

  try {
    fs.rm(path, toRmOptions(options), settle)
  } catch (err) {
    // `fs.rm` throws synchronously on argument validation instead of routing to
    // the callback. Deferring keeps every error path asynchronous, so a caller
    // can never observe the callback firing before its own call returns.
    process.nextTick(settle, err)
  }
}

/**
 * Synchronous variant, matching rimraf@3's `rimraf.sync`.
 *
 * This one DOES throw on failure — that is its contract, and the "never throw"
 * rule above is about the callback-style function the plugin actually calls.
 * Nothing in the dependency tree uses this entry point; it exists so that the
 * override is a faithful drop-in.
 *
 * @param {string|Buffer|URL} path
 * @param {{maxBusyTries?: number}} [options]
 * @returns {void}
 */
function rimrafSync(path, options) {
  fs.rmSync(path, toRmOptions(options))
}

// `require('rimraf')` in v3 returns the callable itself; the named properties
// are attached to it. Keep both shapes so a stray `.rimraf` / `.rimrafSync`
// destructure (the rimraf v4+ spelling) also resolves.
module.exports = rimraf
module.exports.sync = rimrafSync
module.exports.rimraf = rimraf
module.exports.rimrafSync = rimrafSync
