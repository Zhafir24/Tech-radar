#!/usr/bin/env node
/**
 * Dev-server supervisor.
 *
 * Keeps `vite` alive on port 5173 no matter what:
 *  - Frees the port before starting (kills any stuck previous instance)
 *  - Restarts Vite immediately if it exits for any reason
 *  - Writes every event to serve.log for post-mortem
 *
 * Stop it for real with Ctrl+C (or `taskkill` on the supervisor PID).
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

/**
 * Windows: find PIDs listening on `port` via netstat and taskkill them.
 * Silent if none are found. Never kills our own PID.
 */
function killPort(port) {
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
    for (const pid of pids) {
      if (pid === String(process.pid)) continue;
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        log(`Freed port ${port} (killed PID ${pid})`);
      } catch {
        // Process may have already exited — safe to ignore.
      }
    }
  } catch {
    // netstat failed — nothing to free, or Windows API glitch. Proceed.
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
