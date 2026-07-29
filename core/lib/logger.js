// Minimal application logger. Writes structured JSON lines to ./logs/app.log
// (relative to process.cwd() — run from a client's directory to log there)
// and mirrors a human-readable line to the console. One JSON object per line
// so the log is easy to tail, grep, or ingest later.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const logDir = join(process.cwd(), 'logs');
const logFile = join(logDir, 'app.log');

function write(level, message, data) {
  const entry = { ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) };
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`Failed to write log: ${err.message}`);
  }
  const out = level === 'error' ? console.error : console.log;
  out(`[${entry.ts}] ${level.toUpperCase()} ${message}`);
}

export const logger = {
  info: (message, data) => write('info', message, data),
  warn: (message, data) => write('warn', message, data),
  error: (message, data) => write('error', message, data),
  file: logFile,
};
