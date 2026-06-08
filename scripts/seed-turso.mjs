// Seed a Turso (LibSQL) database from the local SQLite file.
//
// Usage:
//   1. Put TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in .env.local (or the env), e.g.
//        TURSO_DATABASE_URL=libsql://vaidyaroute-you.turso.io
//        TURSO_AUTH_TOKEN=eyJ...
//   2. npm run seed:turso
//
// Reads ./data/vaidyaroute.db (override with SEED_SOURCE_URL=file:/path.db) and
// copies stores → visits → routes → settings into the remote DB with
// INSERT OR REPLACE, so it's safe to re-run. The destination schema is created
// if it doesn't exist yet.

import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

// ---- load .env.local into process.env (only keys not already set) ----------
function loadEnvLocal() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();

const SOURCE_URL =
  process.env.SEED_SOURCE_URL ||
  `file:${path.join(process.cwd(), 'data', 'vaidyaroute.db')}`;
const DEST_URL = process.env.TURSO_DATABASE_URL?.trim();
const DEST_TOKEN = process.env.TURSO_AUTH_TOKEN?.trim();

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!DEST_URL) die('TURSO_DATABASE_URL is not set (in .env.local or env).');
if (DEST_URL.startsWith('file:')) {
  die('TURSO_DATABASE_URL points at a local file — refusing to seed onto a file DB.');
}
if (DEST_URL === SOURCE_URL) die('Source and destination are the same database.');

const DEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    phone TEXT,
    category TEXT,
    google_rating REAL,
    hours_json TEXT,
    types_json TEXT,
    relevance_score INTEGER,
    discovered_at TEXT DEFAULT (datetime('now')),
    refreshed_at TEXT DEFAULT (datetime('now')),
    force_include INTEGER NOT NULL DEFAULT 0,
    is_irrelevant INTEGER NOT NULL DEFAULT 0,
    skipped_until TEXT
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT REFERENCES stores(id),
    visited_at TEXT DEFAULT (datetime('now')),
    outcome TEXT,
    notes TEXT,
    next_visit_date TEXT
  );
  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_ids_json TEXT NOT NULL,
    generated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_visits_store_id ON visits(store_id);
  CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
  CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date);
`;

// Parent-first so foreign keys stay valid.
const TABLES = ['stores', 'visits', 'routes', 'settings'];
const CHUNK = 50;

async function columnsOf(client, table) {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  return rs.rows.map((r) => String(r.name));
}

async function copyTable(source, dest, table) {
  const srcCols = await columnsOf(source, table);
  const destCols = new Set(await columnsOf(dest, table));
  // Only copy columns that exist on both sides.
  const cols = srcCols.filter((c) => destCols.has(c));
  if (cols.length === 0) {
    console.log(`  • ${table}: no matching columns, skipped`);
    return 0;
  }

  const rows = (await source.execute(`SELECT * FROM ${table}`)).rows;
  if (rows.length === 0) {
    console.log(`  • ${table}: 0 rows`);
    return 0;
  }

  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => ({
      sql,
      args: cols.map((c) => row[c] ?? null),
    }));
    await dest.batch(chunk, 'write');
    written += chunk.length;
  }
  console.log(`  • ${table}: ${written} rows`);
  return written;
}

async function main() {
  console.log(`Seeding Turso from ${SOURCE_URL}`);
  console.log(`              into ${DEST_URL}\n`);

  const source = createClient({ url: SOURCE_URL });
  const dest = createClient({ url: DEST_URL, authToken: DEST_TOKEN });

  console.log('Ensuring destination schema…');
  await dest.executeMultiple(DEST_SCHEMA);

  console.log('Copying tables:');
  let total = 0;
  for (const table of TABLES) {
    total += await copyTable(source, dest, table);
  }

  console.log(`\n✔ Done — ${total} rows copied.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✖ Seed failed:', err);
  process.exit(1);
});
