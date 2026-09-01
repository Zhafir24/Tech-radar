import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ───────────────── what is under test ─────────────────
 * `POST /api/scrape` in scripts/api/sources-api.mjs starts the scrape pipeline
 * as a child process. Two things about that spawn are load-bearing and easy to
 * regress:
 *
 *   1. It must NOT pass `shell`. The call used to be
 *      spawn("npm.cmd", ["run", "scrape"], { shell: true }) so that Windows
 *      could reach npm.cmd at all, and Node emits DEP0190 for exactly that
 *      shape — args handed to a shell are concatenated, not escaped. (It also
 *      really broke: the shell split "C:\Program Files\nodejs\node.exe" at the
 *      space.) Anyone re-introducing a shell brings the warning back.
 *   2. It must spawn process.execPath with an absolute path to the pipeline
 *      entry resolved from import.meta.url — not `npm`, which is regularly
 *      absent from PATH on macOS under nvm/Homebrew, and not a path built from
 *      process.cwd(), which the dev server does not control.
 *
 * The scraper itself makes live network requests, so it must never actually
 * run here. `import { spawn } from "node:child_process"` is a live binding to
 * the builtin namespace, so patching the builtin's export and calling
 * syncBuiltinESMExports() swaps the function sources-api.mjs calls. The stub
 * records what the module asked for and then runs a trivial throwaway child
 * instead, which keeps the rest of the path real: stdout/stderr tail capture,
 * the "close" handler and the scrapeState bookkeeping all execute for real.
 */

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const realSpawn = childProcess.spawn;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { handleSourcesApi } = await import(
  pathToFileURL(path.join(ROOT, "scripts", "api", "sources-api.mjs")).href
);

/** Records the requested spawn, then runs a harmless child in its place. */
function stubSpawn(childArgs) {
  const calls = [];
  childProcess.spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return realSpawn(process.execPath, childArgs, options);
  };
  syncBuiltinESMExports();
  return calls;
}

function restoreSpawn() {
  childProcess.spawn = realSpawn;
  syncBuiltinESMExports();
}

function fakeReq(method, url) {
  const req = Readable.from([]); // no body — /api/scrape does not read one
  req.method = method;
  req.url = url;
  req.headers = {};
  return req;
}

async function call(method, url) {
  let body = "";
  const res = {
    statusCode: 0,
    setHeader() {},
    end(payload) {
      body = payload;
    },
  };
  await handleSourcesApi(fakeReq(method, url), res);
  return { status: res.statusCode, body: JSON.parse(body) };
}

/** Poll GET /api/scrape until the child's "close" has reset the state. */
async function waitForIdle() {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const state = await call("GET", "/api/scrape");
    if (!state.body.running) return state.body;
    assert.ok(Date.now() < deadline, "scrape never reported close");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("POST /api/scrape spawns node directly, with no shell (DEP0190)", async (t) => {
  const calls = stubSpawn(["-e", "console.log('ok')"]);
  t.after(restoreSpawn);

  const started = await call("POST", "/api/scrape");
  assert.equal(started.status, 202);
  assert.equal(started.body.started, true);

  assert.equal(calls.length, 1);
  const { command, args, options } = calls[0];

  // A shell in ANY form is what DEP0190 fires on when args are passed too.
  assert.ok(!("shell" in options), "spawn options must not carry `shell`");

  assert.equal(command, process.execPath);
  assert.equal(args.length, 1);
  assert.equal(args[0], path.join(ROOT, "scripts", "scrape", "index.mjs"));
  assert.ok(path.isAbsolute(args[0]), "entry path must be absolute");
  assert.ok(fs.existsSync(args[0]), "entry path must point at a real file");

  // cwd is pinned to the repo root, not to whatever launched the dev server.
  assert.equal(options.cwd, ROOT);

  await waitForIdle();
});

test("scrapeState tracks running, exit code and output tail", async (t) => {
  // process.exitCode rather than process.exit(): on Windows a pipe write is
  // async, and exiting outright can drop the output this test asserts on.
  const calls = stubSpawn([
    "-e",
    "console.log('out line'); console.error('err line'); process.exitCode = 3;",
  ]);
  t.after(restoreSpawn);

  const started = await call("POST", "/api/scrape");
  assert.equal(started.status, 202);

  const during = await call("GET", "/api/scrape");
  assert.equal(during.body.running, true, "running flips to true immediately");
  assert.equal(during.body.lastExitCode, null, "previous exit code is cleared");

  // A second start while one is in flight must be refused, not stacked.
  const duplicate = await call("POST", "/api/scrape");
  assert.equal(duplicate.status, 409);

  const finished = await waitForIdle();
  assert.equal(finished.running, false, "running resets on close");
  assert.equal(finished.lastExitCode, 3, "child exit code is captured");
  assert.ok(finished.finishedAt, "finishedAt is stamped");
  // Both pipes feed the same tail buffer. stdout and stderr are independent
  // streams, so compare as a set — their interleaving is not guaranteed.
  assert.deepEqual([...finished.tail].sort(), ["err line", "out line"]);

  assert.equal(calls.length, 1);
});

test("a child that never starts still clears running, via close", async (t) => {
  // The original bug: reset lived in "exit", which a failed spawn never emits.
  // Only "error" + "close" fire, so `running` stuck true and every later
  // rescrape returned 409 forever.
  const missing = path.join(ROOT, "scripts", "scrape", "__no_such_entry__.mjs");
  const calls = [];
  childProcess.spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return realSpawn(missing, [], { ...options, shell: false });
  };
  syncBuiltinESMExports();
  t.after(restoreSpawn);

  const started = await call("POST", "/api/scrape");
  assert.equal(started.status, 202);

  const finished = await waitForIdle();
  assert.equal(finished.running, false, "running must not stick after a failed spawn");
  assert.ok(finished.lastError, "the spawn error is recorded");
  assert.equal(calls.length, 1);

  // And the API is usable again afterwards.
  const again = await call("GET", "/api/scrape");
  assert.equal(again.body.running, false);
});
