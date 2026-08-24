import fs from "node:fs";
import path from "node:path";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL ?? "info"] ?? LEVELS.info;

let logStream = null;

export function initFileLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `scrape-${stamp}.log`);
  logStream = fs.createWriteStream(file, { flags: "a" });
  return file;
}

function emit(level, message, extra) {
  if (LEVELS[level] < currentLevel) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra ? { data: extra } : {}),
  });
  process.stdout.write(line + "\n");
  if (logStream) logStream.write(line + "\n");
}

export const log = {
  debug: (msg, extra) => emit("debug", msg, extra),
  info: (msg, extra) => emit("info", msg, extra),
  warn: (msg, extra) => emit("warn", msg, extra),
  error: (msg, extra) => emit("error", msg, extra),
};
