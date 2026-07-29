// Minimal zero-dependency .env loader. Merges KEY=VALUE lines into process.env
// without overriding existing values.
//
// This lives in core/ so it carries no assumption about where a client's
// .env actually is (each client's .env lives under clients/<name>/, not at
// a fixed offset from this file). Pass an absolute path, or a path relative
// to process.cwd() (e.g. run from inside clients/<name>/ and just use the
// default '.env').
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function loadEnv(file = '.env') {
  const path = isAbsolute(file) ? file : join(process.cwd(), file);
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // no .env — use real env vars
  }
}

export function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  return Object.fromEntries(keys.map((k) => [k, process.env[k]]));
}
