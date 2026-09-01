import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

/* ───────────────── what is under test ─────────────────
 * `vendor/rimraf-shim` replaces rimraf@3 for the whole dependency tree via an
 * npm `override`, so that the deprecated rimraf -> glob -> inflight chain never
 * gets installed. Its one real consumer is the stealth plugin's profile
 * cleanup:
 *
 *   node_modules/puppeteer-extra-plugin-user-data-dir/index.js
 *     const rimraf = require('rimraf')
 *     rimraf(this._userDataDir, { maxBusyTries: 4 }, err => { debug(err) })
 *
 * That call is not wrapped in try/catch and the callback only logs, so the two
 * properties these tests defend are: it must delete, and it must NEVER throw
 * synchronously. See vendor/rimraf-shim/index.js for the full rationale.
 *
 * Resolved through `require` rather than `import` because the shim is CommonJS
 * and the consumer reaches it as `require('rimraf')` — this exercises the same
 * resolution path.
 */
const require_ = createRequire(import.meta.url);
const rimraf = require_("../../../vendor/rimraf-shim/index.js");

/**
 * Fixtures live in the OS temp dir, never inside the repo — the thing under
 * test deletes directory trees recursively.
 *
 * `await fn(dir)`, not `fn(dir)`: with an async body the unawaited form tears
 * the fixture down while the test is still running, which silently turns
 * "rimraf deleted the target" into "the cleanup deleted everything".
 */
async function inTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-rimraf-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Promise wrapper so a test can await the callback without nesting. */
function removed(...args) {
  return new Promise((resolve, reject) => {
    try {
      rimraf(...args, (err) => resolve(err));
    } catch (err) {
      // A synchronous throw is a test failure, not a rejection to swallow.
      reject(err);
    }
  });
}

/** A directory several levels deep, with files at every level. */
function makeNestedTree(root) {
  const deep = path.join(root, "a", "b", "c", "d");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(root, "a", "top.txt"), "top");
  fs.writeFileSync(path.join(root, "a", "b", "mid.txt"), "mid");
  fs.writeFileSync(path.join(deep, "leaf.txt"), "leaf");
  fs.mkdirSync(path.join(root, "a", "sibling"));
  fs.writeFileSync(path.join(root, "a", "sibling", "other.txt"), "other");
  return path.join(root, "a");
}

/* ───────────────── deletion ───────────────── */

test("rimraf: deletes a deeply nested directory tree and calls back with null", async () => {
  await inTempDir(async (dir) => {
    const target = makeNestedTree(dir);
    assert.ok(fs.existsSync(path.join(target, "b", "c", "d", "leaf.txt")));

    const err = await removed(target, {});
    assert.equal(err, null);
    assert.equal(fs.existsSync(target), false);
    // The parent survives — only the requested path is removed.
    assert.equal(fs.existsSync(dir), true);
  });
});

test("rimraf: deletes a single file", async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, "lonely.txt");
    fs.writeFileSync(file, "delete me");

    const err = await removed(file, {});
    assert.equal(err, null);
    assert.equal(fs.existsSync(file), false);
  });
});

test("rimraf: a non-existent path is not an error (force: true)", async () => {
  // rimraf@3 treated ENOENT as success, and so must this — the plugin fires
  // cleanup on disconnect, which can happen after the profile is already gone.
  await inTempDir(async (dir) => {
    const missing = path.join(dir, "was", "never", "here");
    const err = await removed(missing, { maxBusyTries: 4 });
    assert.equal(err, null);
  });
});

test("rimraf: an empty directory is removed", async () => {
  await inTempDir(async (dir) => {
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    assert.equal(await removed(empty, {}), null);
    assert.equal(fs.existsSync(empty), false);
  });
});

/* ───────────────── call shapes ───────────────── */

test("rimraf: the two-argument form rimraf(path, cb) works", async () => {
  await inTempDir(async (dir) => {
    const target = makeNestedTree(dir);
    const err = await new Promise((resolve) => {
      rimraf(target, (e) => resolve(e));
    });
    assert.equal(err, null);
    assert.equal(fs.existsSync(target), false);
  });
});

test("rimraf: omitting the callback does not throw and still deletes", async () => {
  await inTempDir(async (dir) => {
    const target = makeNestedTree(dir);
    assert.doesNotThrow(() => rimraf(target));
    assert.doesNotThrow(() => rimraf(target, { maxBusyTries: 4 }));

    // Deletion is asynchronous; give the event loop a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fs.existsSync(target), false);
  });
});

test("rimraf: maxBusyTries is accepted, and so are junk values for it", async () => {
  // The plugin passes { maxBusyTries: 4 }; fs.rm would reject a non-integer
  // maxRetries outright, so the shim sanitises rather than surfacing an error.
  await inTempDir(async (dir) => {
    for (const options of [
      { maxBusyTries: 4 },
      { maxBusyTries: 0 },
      { maxBusyTries: -1 },
      { maxBusyTries: "4" },
      { maxBusyTries: undefined },
      { maxBusyTries: null },
      {},
      undefined,
      null,
    ]) {
      const target = makeNestedTree(dir);
      const err = await removed(target, options);
      assert.equal(err, null, `failed for ${JSON.stringify(options)}`);
      assert.equal(fs.existsSync(target), false);
    }
  });
});

/* ───────────────── the crash that this shim must not reproduce ───────────────── */

test("rimraf: an invalid path reaches the CALLBACK instead of throwing", async () => {
  // fs.rm validates arguments SYNCHRONOUSLY and throws
  // (TypeError [ERR_INVALID_ARG_VALUE]: ... without null bytes). The plugin's
  // call site has no try/catch, so an unwrapped throw here would abort the
  // scrape with exit code 1. Every error must arrive via the callback.
  let threwSynchronously = false;
  const err = await new Promise((resolve) => {
    try {
      rimraf("bad\0path", { maxBusyTries: 4 }, (e) => resolve(e));
    } catch (e) {
      threwSynchronously = true;
      resolve(e);
    }
  });

  assert.equal(threwSynchronously, false, "the shim threw synchronously");
  assert.ok(err instanceof Error);
  assert.match(String(err.code), /^ERR_INVALID_ARG/);
});

test("rimraf: non-string paths are reported, never thrown", async () => {
  for (const badPath of [undefined, null, 42, {}, true]) {
    let threwSynchronously = false;
    const err = await new Promise((resolve) => {
      try {
        rimraf(badPath, {}, (e) => resolve(e));
      } catch (e) {
        threwSynchronously = true;
        resolve(e);
      }
    });
    assert.equal(threwSynchronously, false, `threw synchronously for ${String(badPath)}`);
    assert.ok(err instanceof Error, `no error delivered for ${String(badPath)}`);
  }
});

test("rimraf: an invalid path with no callback at all does not crash", async () => {
  // The belt-and-braces case: bad argument AND nothing to report it to. The
  // error must be swallowed, not rethrown from a later tick as an uncaught
  // exception that would take the process down.
  assert.doesNotThrow(() => rimraf("bad\0path"));
  assert.doesNotThrow(() => rimraf(undefined));
  // Survive long enough for a deferred throw to surface if there were one.
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("rimraf: the callback fires asynchronously, never before the call returns", async () => {
  // Uniform timing on both paths, so a caller cannot see reentrancy on the
  // error path that it would never see on the success path.
  await inTempDir(async (dir) => {
    for (const target of [makeNestedTree(dir), "bad\0path"]) {
      let calledDuringCall = true;
      const settled = new Promise((resolve) => {
        rimraf(target, {}, () => {
          resolve(calledDuringCall);
        });
      });
      calledDuringCall = false;
      assert.equal(await settled, false);
    }
  });
});

test("rimraf: the callback runs exactly once", async () => {
  await inTempDir(async (dir) => {
    const target = makeNestedTree(dir);
    let calls = 0;
    await new Promise((resolve) => {
      rimraf(target, {}, () => {
        calls += 1;
        setTimeout(resolve, 150);
      });
    });
    assert.equal(calls, 1);
  });
});

/* ───────────────── sync variant ───────────────── */

test("rimraf.sync: deletes a tree and a missing path is not an error", async () => {
  await inTempDir((dir) => {
    const target = makeNestedTree(dir);
    rimraf.sync(target);
    assert.equal(fs.existsSync(target), false);

    // force: true — deleting it a second time is a no-op, not a throw.
    assert.doesNotThrow(() => rimraf.sync(target));
    assert.doesNotThrow(() => rimraf.sync(target, { maxBusyTries: 4 }));
  });
});

/* ───────────────── exported shape ───────────────── */

test("module.exports is the callable itself, with arity 3", () => {
  // `const rimraf = require('rimraf')` followed by `rimraf(...)` is exactly how
  // puppeteer-extra-plugin-user-data-dir uses it. rimraf 5/6 export an object
  // here, which is why they cannot be used: "TypeError: rimraf is not a
  // function".
  assert.equal(typeof rimraf, "function");
  assert.equal(rimraf.length, 3);
});

test("module.exports exposes .sync, .rimraf and .rimrafSync", () => {
  assert.equal(typeof rimraf.sync, "function");
  assert.equal(typeof rimraf.rimraf, "function");
  assert.equal(typeof rimraf.rimrafSync, "function");
  assert.equal(rimraf.rimraf, rimraf);
  assert.equal(rimraf.rimrafSync, rimraf.sync);
});

test("the vendored package declares version 3.0.2 so it satisfies ^3.0.2", () => {
  // puppeteer-extra-plugin-user-data-dir depends on "rimraf": "^3.0.2". If this
  // version ever drifts, npm rejects the override and the deprecated chain
  // comes back.
  const pkg = require_("../../../vendor/rimraf-shim/package.json");
  assert.equal(pkg.name, "rimraf");
  assert.equal(pkg.version, "3.0.2");
  assert.equal(pkg.main, "index.js");
  // Zero dependencies is the entire point — glob and inflight must stay gone.
  assert.equal(pkg.dependencies, undefined);
});

/* ───────────────── the consumer's exact call path ───────────────── */

test("the plugin's exact 3-argument call deletes a real profile directory", async () => {
  // Reproduces puppeteer-extra-plugin-user-data-dir's cleanup verbatim, against
  // a directory shaped like a Chrome profile.
  await inTempDir(async (dir) => {
    const userDataDir = fs.mkdtempSync(path.join(dir, "puppeteer_dev_profile-"));
    fs.mkdirSync(path.join(userDataDir, "Default", "Cache"), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "Default", "Preferences"), "{}");
    fs.writeFileSync(path.join(userDataDir, "Default", "Cache", "data_0"), "x");

    const logged = [];
    const debug = (err) => logged.push(err);

    await new Promise((resolve) => {
      rimraf(userDataDir, { maxBusyTries: 4 }, (err) => {
        debug(err);
        resolve();
      });
    });

    assert.equal(fs.existsSync(userDataDir), false);
    assert.deepEqual(logged, [null]);
  });
});
