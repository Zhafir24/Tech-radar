#!/usr/bin/env node
/**
 * Dev-server supervisor.
 *
 * Keeps `vite` alive on port 5173 no matter what:
 *  - Frees the port before starting (kills any stuck previous instance)
 *  - Restarts Vite immediately if it exits for any reason
 *  - Writes every event to serve.log for post-mortem
 *
 * Stop it for real with Ctrl+C (or kill the supervisor PID).
 *
 * This is the DEVELOPMENT supervisor and it reclaims the port by force. That
 * is fine on a machine where the only thing it ever displaces is a stale copy
 * of itself. Do NOT ship it: scripts/serve-portable.mjs is the distributable
 * launcher, and it takes the next free port instead of killing anything.
 */
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = 5173;
const HOST = "127.0.0.1";
const RESTART_DELAY_MS = 2000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LOG_FILE = path.join(ROOT, "serve.log");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    process.stdout.write(line);
  } catch {
    // stdout may be detached (hidden VBS launcher) — ignore.
  }
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // If we can't log, we can't recover — carry on.
  }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => {
      probe.close();
      resolve(false);
    });
    probe.listen(port, HOST);
  });
}

const IS_WINDOWS = process.platform === "win32";

/**
 * PIDs currently listening on `port`.
 *
 * Windows has netstat; macOS and Linux use lsof, which is preinstalled on
 * macOS and present on most Linux images. If the tool is missing or fails we
 * return nothing, and the caller simply skips the kill — the same degraded
 * path Windows already had.
 */
function listeningPids(port) {
  try {
    if (IS_WINDOWS) {
      const output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      const pattern = new RegExp(
        `\\s(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|\\[::\\]|\\[::1\\]):${port}\\s.*LISTENING\\s+(\\d+)`,
      );
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(pattern);
        if (match) pids.add(match[1]);
      }
      return [...pids];
    }

    // -t: PIDs only, -sTCP:LISTEN: ignore established connections to the port.
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(output.split(/\s+/).filter(Boolean))];
  } catch {
    // lsof exits non-zero when nothing matches, and netstat can glitch.
    // Either way there is nothing we can act on.
    return [];
  }
}

/**
 * Free `port` by terminating whatever listens on it. Silent if nothing is
 * found. Never kills our own PID.
 */
function killPort(port) {
  for (const pid of listeningPids(port)) {
    if (pid === String(process.pid)) continue;
    try {
      if (IS_WINDOWS) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(Number(pid), "SIGKILL");
      }
      log(`Freed port ${port} (killed PID ${pid})`);
    } catch {
      // Process may have already exited, or belongs to another user.
    }
  }
}

let child = null;
let restartCount = 0;
let shuttingDown = false;

async function startVite() {
  if (await isPortInUse(PORT)) {
    log(`Port ${PORT} in use — freeing it first`);
    killPort(PORT);
    await new Promise((r) => setTimeout(r, 500));
  }

  log(`Starting Vite (attempt ${restartCount + 1})`);
  child = spawn(
    process.execPath,
    [VITE_BIN, "--port", String(PORT), "--strictPort", "--host", HOST],
    { cwd: ROOT, stdio: "inherit" },
  );

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(
      `Vite exited (code=${code ?? "null"}, signal=${signal ?? "none"}) — ` +
        `restarting in ${RESTART_DELAY_MS}ms`,
    );
    restartCount++;
    child = null;
    setTimeout(startVite, RESTART_DELAY_MS);
  });

  child.on("error", (err) => {
    log(`Failed to spawn Vite: ${err.message}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    shuttingDown = true;
    log(`Received ${signal} — supervisor shutting down`);
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

log(`Supervisor starting (PID ${process.pid}); logs → ${LOG_FILE}`);
startVite();
