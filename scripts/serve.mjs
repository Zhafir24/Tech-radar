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
 * Windows has netstat. Elsewhere we try lsof first — macOS always ships it —
 * and fall back to procfs, because many Linux images have NO tool that can
 * answer this: the official node:24-bookworm image carries neither lsof nor
 * ss, fuser, netstat or ip. Returning nothing there is not a safe degradation:
 * killPort() then silently does nothing, Vite fails on --strictPort, and the
 * supervisor respawns it every two seconds forever.
 */
function listeningPids(port) {
  if (IS_WINDOWS) {
    try {
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
    } catch {
      return [];
    }
  }

  try {
    // -t: PIDs only, -sTCP:LISTEN: ignore established connections to the port.
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = [...new Set(output.split(/\s+/).filter((s) => /^\d+$/.test(s)))];
    if (pids.length > 0) return pids;
  } catch {
    // lsof absent, or it exited non-zero because nothing matched. Both look
    // the same from here, so always give procfs a chance.
  }
  return listeningPidsFromProc(port);
}

/**
 * lsof-free fallback for Linux, via /proc. Finds the socket inodes listening
 * on `port`, then the process holding a descriptor for one of them.
 * Returns [] where /proc does not exist (macOS), leaving behaviour unchanged.
 */
function listeningPidsFromProc(port) {
  try {
    const inodes = new Set();
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10 || cols[3] !== "0A") continue; // 0A = TCP_LISTEN
        if (parseInt(cols[1].split(":")[1], 16) !== port) continue;
        inodes.add(cols[9]);
      }
    }
    if (inodes.size === 0) return [];

    const pids = new Set();
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      let fds;
      try {
        fds = fs.readdirSync(`/proc/${pid}/fd`);
      } catch {
        continue; // Another user's process — not ours to inspect or kill.
      }
      for (const fd of fds) {
        let link;
        try {
          link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        } catch {
          continue;
        }
        const match = /^socket:\[(\d+)\]$/.exec(link);
        if (match && inodes.has(match[1])) {
          pids.add(pid);
          break;
        }
      }
    }
    return [...pids];
  } catch {
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

/** An exit sooner than this after start counts as an instant failure. */
const RAPID_EXIT_MS = 5000;
const MAX_RAPID_FAILURES = 4;

let child = null;
let restartCount = 0;
let rapidFailures = 0;
let shuttingDown = false;

async function startVite() {
  if (await isPortInUse(PORT)) {
    log(`Port ${PORT} in use — freeing it first`);
    killPort(PORT);
    await new Promise((r) => setTimeout(r, 500));
  }

  log(`Starting Vite (attempt ${restartCount + 1})`);
  const startedAt = Date.now();
  child = spawn(
    process.execPath,
    [VITE_BIN, "--port", String(PORT), "--strictPort", "--host", HOST],
    { cwd: ROOT, stdio: "inherit" },
  );

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    child = null;

    // Without a ceiling this loops forever at ~2s per attempt, spawning a
    // process each time and growing serve.log with nobody watching — the
    // autostart launcher runs it in a hidden window.
    if (Date.now() - startedAt < RAPID_EXIT_MS) rapidFailures++;
    else rapidFailures = 0;

    if (rapidFailures > MAX_RAPID_FAILURES) {
      log(
        `Vite exited immediately ${rapidFailures} times in a row — giving up. ` +
          `Something else is holding port ${PORT} and could not be freed; ` +
          `close it and start again.`,
      );
      process.exitCode = 1;
      return;
    }

    log(
      `Vite exited (code=${code ?? "null"}, signal=${signal ?? "none"}) — ` +
        `restarting in ${RESTART_DELAY_MS}ms`,
    );
    restartCount++;
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
