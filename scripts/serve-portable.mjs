#!/usr/bin/env node
/**
 * Launcher for the portable bundle.
 *
 * Deliberately NOT scripts/serve.mjs. That one frees port 5173 by
 * force-killing whoever holds it, which is fine on the author's own machine
 * (it only ever reclaims a stale instance of itself) but wrong for software
 * handed to someone else:
 *
 *   - it would kill an unrelated process that happens to use 5173, and
 *   - if two copies of it run at once — e.g. the autostart dev server plus
 *     an extracted bundle — each keeps killing the other's Vite forever,
 *     producing an endless "Vite exited (code=1) — restarting" loop.
 *
 * This launcher instead:
 *   - picks the first FREE port in [BASE_PORT, BASE_PORT + PORT_SPAN),
 *   - never terminates a process it does not own,
 *   - opens the browser itself once the server actually answers (it is the
 *     only thing that knows which port was chosen), and
 *   - gives up with a readable diagnosis after repeated instant failures
 *     rather than looping forever.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const BASE_PORT = 5173;
const PORT_SPAN = 20;

const RESTART_DELAY_MS = 2000;
/** An exit sooner than this after start counts as an instant failure. */
const RAPID_EXIT_MS = 5000;
const MAX_RAPID_FAILURES = 4;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LOG_FILE = path.join(ROOT, "serve.log");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    process.stdout.write(line);
  } catch {
    // stdout may be detached — ignore.
  }
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // If we cannot log, carry on; logging is not worth crashing over.
  }
}

/** True if nothing is listening on `port` (i.e. we can bind it ourselves). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function findFreePort() {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_SPAN; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

/**
 * Resolves once something accepts a TCP connection on `port`.
 *
 * `isStale()` lets the caller abandon the poll — without it the pending
 * 250 ms retry chain keeps the event loop alive, so the process would linger
 * for the full timeout after we have already decided to give up.
 */
function waitUntilServing(port, timeoutMs, isStale) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      if (isStale() || Date.now() > deadline) return resolve(false);
      const socket = net.connect({ host: HOST, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (isStale()) return resolve(false);
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function openBrowser(url) {
  try {
    // `start` is a cmd builtin; the empty "" is the window title that start
    // otherwise steals from the first quoted argument.
    spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch (err) {
    log(`Could not open the browser automatically: ${err?.message ?? err}`);
    log(`Open this address manually: ${url}`);
  }
}

let child = null;
let shuttingDown = false;
let gaveUp = false;
let rapidFailures = 0;
let browserOpened = false;
/** Bumped per start attempt so an older readiness poll can tell it is stale. */
let generation = 0;

async function start() {
  const myGeneration = ++generation;
  const port = await findFreePort();
  if (port === null) {
    log(
      `No free port found in ${BASE_PORT}-${BASE_PORT + PORT_SPAN - 1}. ` +
        `Close some servers and try again.`,
    );
    process.exitCode = 1;
    return;
  }

  if (port !== BASE_PORT) {
    log(`Port ${BASE_PORT} is in use by another program — using ${port} instead.`);
  }

  const url = `http://localhost:${port}/`;
  log(`Starting Vite on ${url}`);
  const startedAt = Date.now();

  child = spawn(
    process.execPath,
    [VITE_BIN, "--port", String(port), "--strictPort", "--host", HOST],
    { cwd: ROOT, stdio: "inherit" },
  );

  child.on("error", (err) => {
    log(`Failed to start Vite: ${err.message}`);
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown) return;

    const ranFor = Date.now() - startedAt;
    if (ranFor < RAPID_EXIT_MS) {
      rapidFailures++;
    } else {
      rapidFailures = 0; // It ran fine for a while; this is a fresh problem.
    }

    if (rapidFailures > MAX_RAPID_FAILURES) {
      gaveUp = true; // lets any pending readiness poll unblock the event loop
      log(
        `Vite exited immediately ${rapidFailures} times in a row — giving up ` +
          `instead of restarting forever.`,
      );
      log("");
      log("Most likely causes:");
      log("  - Another copy of the Tech Radar is running and competing for");
      log("    the port. Close it, then start this one again.");
      log("  - The extraction was incomplete. Delete the folder and unzip");
      log("    again (7-Zip handles deep paths better than Explorer).");
      log(`  - Full log: ${LOG_FILE}`);
      process.exitCode = 1;
      return;
    }

    log(
      `Vite exited (code=${code ?? "null"}, signal=${signal ?? "none"}) — ` +
        `restarting in ${RESTART_DELAY_MS}ms`,
    );
    setTimeout(() => void start(), RESTART_DELAY_MS);
  });

  if (!browserOpened) {
    const serving = await waitUntilServing(
      port,
      60_000,
      () => shuttingDown || gaveUp || generation !== myGeneration,
    );
    if (serving && !browserOpened && !shuttingDown) {
      browserOpened = true;
      log(`Opening ${url}`);
      openBrowser(url);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    shuttingDown = true;
    log(`Received ${signal} — shutting down`);
    if (child) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
    process.exit(0);
  });
}

log(`Portable launcher starting (PID ${process.pid}); logs → ${LOG_FILE}`);
void start();
