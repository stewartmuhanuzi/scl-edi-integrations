// Apply SQL migrations in core/supabase/migrations/ (sorted by filename) to
// a client's Supabase Postgres database. Idempotent migrations can be
// re-run safely. The schema is universal (core/), but each client has their
// own Supabase project/.env under clients/<name>/.
//
// Usage:
//   npm install               # first time, to get the pg dependency
//   npm run migrate                    # auto-detects the client if only one exists
//   npm run migrate -- scl-footwear    # or name it explicitly
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { loadEnv, requireEnv } from '../core/lib/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const clientsDir = join(repoRoot, 'clients');

function resolveClientName() {
  const arg = process.argv[2];
  if (arg) return arg;
  const entries = readdirSync(clientsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 1) return entries[0].name;
  console.error(
    entries.length === 0
      ? `No client folders found under ${clientsDir}`
      : `Multiple client folders found — specify one: npm run migrate -- <client-name>\nFound: ${entries.map((e) => e.name).join(', ')}`,
  );
  process.exit(1);
}

const clientName = resolveClientName();
const clientDir = join(clientsDir, clientName);
loadEnv(join(clientDir, '.env'));

console.log(`Client: ${clientName}`);

// Use the shared pooler (IPv4) — works everywhere, including hosts without
// IPv6. Falls back to the direct host if pooler vars aren't set.
const host = process.env.SUPABASE_POOLER_HOST || process.env.SUPABASE_DB_HOST;
const user = process.env.SUPABASE_POOLER_USER || process.env.SUPABASE_DB_USER;
requireEnv('SUPABASE_DB_PASSWORD');
if (!host || !user) {
  console.error('Set SUPABASE_POOLER_HOST + SUPABASE_POOLER_USER (or the SUPABASE_DB_* equivalents) in .env');
  process.exit(1);
}

const migrationsDir = join(repoRoot, 'core', 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

if (!files.length) {
  console.log('No .sql migrations found.');
  process.exit(0);
}

const client = new pg.Client({
  host,
  port: Number(process.env.SUPABASE_POOLER_PORT || process.env.SUPABASE_DB_PORT || 5432),
  user,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

try {
  console.log(`Connecting as ${user}@${host}:${client.port}/${client.database}`);
  await client.connect();
  console.log('Connected.');
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await client.query(sql);
    console.log('ok');
  }
  console.log(`\nDone — ${files.length} migration(s) applied.`);
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
