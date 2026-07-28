// Apply SQL migrations in supabase/migrations/ (sorted by filename) to the
// Supabase Postgres database. Idempotent migrations can be re-run safely.
//
// Usage:
//   npm install        # first time, to get the pg dependency
//   npm run migrate
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { loadEnv, requireEnv } from '../src/lib/env.js';

loadEnv();

// Use the shared pooler (IPv4) — works everywhere, including hosts without
// IPv6. Falls back to the direct host if pooler vars aren't set.
const host = process.env.SUPABASE_POOLER_HOST || process.env.SUPABASE_DB_HOST;
const user = process.env.SUPABASE_POOLER_USER || process.env.SUPABASE_DB_USER;
requireEnv('SUPABASE_DB_PASSWORD');
if (!host || !user) {
  console.error('Set SUPABASE_POOLER_HOST + SUPABASE_POOLER_USER (or the SUPABASE_DB_* equivalents) in .env');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');
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
