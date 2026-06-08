import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { scoreRelevance, MIN_RELEVANCE_SCORE } from './relevance';

// ---------------------------------------------------------------------------
// Connection (singleton)
// ---------------------------------------------------------------------------
// Next.js hot-reloads modules in dev, which would otherwise open a new SQLite
// handle on every change and eventually exhaust file handles. We stash the
// instance on globalThis so a single connection survives reloads.

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'vaidyaroute.db');

// Relevance-cleanup blocklists. Declared here (above `db`) because the cleanup
// runs during createConnection(), which executes when `db` is initialized.

// Google place types that disqualify a store (mirrors the discovery blocklist).
const CLEANUP_BLOCKED_TYPES = new Set<string>([
  'lodging', 'real_estate_agency', 'finance', 'bank', 'atm', 'car_dealer',
  'car_repair', 'car_wash', 'gas_station', 'parking', 'airport',
  'transit_station', 'subway_station', 'hospital', 'dentist', 'doctor',
  'pharmacy', 'school', 'university', 'courthouse', 'embassy', 'funeral_home',
  'cemetery', 'place_of_worship', 'restaurant', 'food', 'bar', 'night_club',
  'cafe', 'bakery', 'meal_delivery', 'meal_takeaway',
]);

// Name keywords (whole-word, case-insensitive) that mark a store irrelevant.
const CLEANUP_NAME_RE =
  /\b(hotel|residence|residences|apartments|suites|inn|ritz|marriott|hilton|hyatt|restaurant|bistro|bar|cafe|café|bakery|grill|pizza|burger|sushi|diner|cantina)\b/i;

const globalForDb = globalThis as unknown as { __vaidyaDb?: BetterSqlite3Database };

function createConnection(): BetterSqlite3Database {
  fs.mkdirSync(DB_DIR, { recursive: true });

  const connection = new Database(DB_PATH);
  // WAL gives better concurrent read/write behavior; foreign keys are off by
  // default in SQLite and must be enabled per-connection.
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');

  migrate(connection);
  return connection;
}

export const db: BetterSqlite3Database = globalForDb.__vaidyaDb ?? createConnection();
if (process.env.NODE_ENV !== 'production') {
  globalForDb.__vaidyaDb = db;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

function migrate(connection: BetterSqlite3Database): void {
  connection.exec(`
    -- Stores discovered via Places API
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,           -- Google Place ID
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      phone TEXT,
      category TEXT,                 -- yoga_studio | health_food | wellness | spa | gym | other
      google_rating REAL,
      hours_json TEXT,               -- raw opening_hours from Places API
      types_json TEXT,               -- raw Google place types array (for relevance filtering)
      relevance_score INTEGER,       -- 0-10 ayurvedic-prospect relevance (>=7 kept)
      discovered_at TEXT DEFAULT (datetime('now')),
      refreshed_at TEXT DEFAULT (datetime('now')),  -- last time we re-queried Google for this store
      force_include INTEGER NOT NULL DEFAULT 0,      -- user override: pin into tonight's route
      is_irrelevant INTEGER NOT NULL DEFAULT 0,      -- user override: permanently exclude from routes
      skipped_until TEXT                             -- "skip today": suppress until this YYYY-MM-DD
    );

    -- Every time he visits (or decides to skip) a store.
    -- outcome is free-form TEXT: the UI offers preset shortcuts
    -- (interested / not_interested / follow_up / no_answer / closed) but the
    -- user can also save any custom outcome string.
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT REFERENCES stores(id),
      visited_at TEXT DEFAULT (datetime('now')),
      outcome TEXT,
      notes TEXT,
      next_visit_date TEXT           -- optional: schedule a follow-up
    );

    -- Daily generated routes
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,            -- YYYY-MM-DD
      store_ids_json TEXT NOT NULL,  -- ordered array of Place IDs
      generated_at TEXT DEFAULT (datetime('now'))
    );

    -- Single-user app config (starting address, visit window, …).
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_visits_store_id ON visits(store_id);
    CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
    CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date);
  `);

  // --- Guarded migrations for DBs created before a column/constraint existed.
  const storeCols = connection
    .prepare('PRAGMA table_info(stores)')
    .all() as { name: string }[];
  if (!storeCols.some((c) => c.name === 'force_include')) {
    connection.exec(
      'ALTER TABLE stores ADD COLUMN force_include INTEGER NOT NULL DEFAULT 0',
    );
  }
  if (!storeCols.some((c) => c.name === 'is_irrelevant')) {
    connection.exec(
      'ALTER TABLE stores ADD COLUMN is_irrelevant INTEGER NOT NULL DEFAULT 0',
    );
  }
  if (!storeCols.some((c) => c.name === 'skipped_until')) {
    connection.exec('ALTER TABLE stores ADD COLUMN skipped_until TEXT');
  }
  if (!storeCols.some((c) => c.name === 'types_json')) {
    connection.exec('ALTER TABLE stores ADD COLUMN types_json TEXT');
  }
  if (!storeCols.some((c) => c.name === 'relevance_score')) {
    connection.exec('ALTER TABLE stores ADD COLUMN relevance_score INTEGER');
  }

  // The original `visits` table had a CHECK constraint pinning `outcome` to five
  // values. We now allow free-form outcomes, so rebuild the table without the
  // constraint when an older schema is detected. SQLite can't DROP a CHECK, so
  // we recreate-and-copy. This is a no-op for freshly created DBs.
  const visitsTable = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visits'")
    .get() as { sql: string } | undefined;
  if (visitsTable && /CHECK\s*\(\s*outcome/i.test(visitsTable.sql)) {
    connection.exec(`
      BEGIN;
      CREATE TABLE visits_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT REFERENCES stores(id),
        visited_at TEXT DEFAULT (datetime('now')),
        outcome TEXT,
        notes TEXT,
        next_visit_date TEXT
      );
      INSERT INTO visits_new (id, store_id, visited_at, outcome, notes, next_visit_date)
        SELECT id, store_id, visited_at, outcome, notes, next_visit_date FROM visits;
      DROP TABLE visits;
      ALTER TABLE visits_new RENAME TO visits;
      CREATE INDEX IF NOT EXISTS idx_visits_store_id ON visits(store_id);
      CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
      COMMIT;
    `);
  }

  // One-time cleanup of pre-blocklist junk data (hotels, restaurants, etc.).
  runIrrelevanceCleanup(connection);

  // One-time backfill of relevance_score for stores discovered before scoring.
  runRelevanceBackfill(connection);
}

/**
 * Runs once per database (guarded by a settings flag): computes a relevance
 * score for every store from its stored name/types/category. Logs how many
 * land at/above the routing threshold.
 */
function runRelevanceBackfill(connection: BetterSqlite3Database): void {
  const FLAG = 'relevance_score_v1';
  const done = connection
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(FLAG);
  if (done) return;

  const rows = connection
    .prepare('SELECT id, name, category, types_json FROM stores')
    .all() as {
    id: string;
    name: string;
    category: string | null;
    types_json: string | null;
  }[];

  const update = connection.prepare(
    'UPDATE stores SET relevance_score = ? WHERE id = ?',
  );

  let kept = 0;
  const apply = connection.transaction(() => {
    for (const r of rows) {
      let types: string[] = [];
      if (r.types_json) {
        try {
          const parsed = JSON.parse(r.types_json);
          if (Array.isArray(parsed)) types = parsed;
        } catch {
          /* ignore */
        }
      }
      const score = scoreRelevance(
        r.name,
        types,
        r.category as Parameters<typeof scoreRelevance>[2],
      );
      update.run(score, r.id);
      if (score >= MIN_RELEVANCE_SCORE) kept += 1;
    }
    connection
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(FLAG, new Date().toISOString());
  });
  apply();

  console.log(
    `[vaidyaroute] relevance backfill: scored ${rows.length} stores, ` +
      `${kept} at/above threshold (${MIN_RELEVANCE_SCORE}).`,
  );
}

// ---------------------------------------------------------------------------
// One-time relevance cleanup of legacy/dirty store data
// ---------------------------------------------------------------------------

/**
 * Runs once per database (guarded by a settings flag): flags stores that match
 * the blocked place types or name keywords as irrelevant, and deletes obviously
 * useless rows (no category + junk name). Logs a summary.
 */
function runIrrelevanceCleanup(connection: BetterSqlite3Database): void {
  const CLEANUP_FLAG = 'irrelevance_cleanup_v1';
  const done = connection
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLEANUP_FLAG);
  if (done) return;

  const rows = connection
    .prepare('SELECT id, name, category, types_json, is_irrelevant FROM stores')
    .all() as {
    id: string;
    name: string;
    category: string | null;
    types_json: string | null;
    is_irrelevant: number;
  }[];

  const markIds: string[] = [];
  const deleteIds: string[] = [];

  for (const r of rows) {
    let types: string[] = [];
    if (r.types_json) {
      try {
        const parsed = JSON.parse(r.types_json);
        if (Array.isArray(parsed)) types = parsed;
      } catch {
        /* ignore malformed */
      }
    }
    const typeBlocked = types.some((t) => CLEANUP_BLOCKED_TYPES.has(t));
    const nameBlocked = CLEANUP_NAME_RE.test(r.name);

    // No category AND a junk name → no plausible relevance, remove entirely.
    if (r.category == null && nameBlocked) {
      deleteIds.push(r.id);
      continue;
    }
    if ((typeBlocked || nameBlocked) && r.is_irrelevant !== 1) {
      markIds.push(r.id);
    }
  }

  const markStmt = connection.prepare(
    'UPDATE stores SET is_irrelevant = 1 WHERE id = ?',
  );
  const delVisitsStmt = connection.prepare(
    'DELETE FROM visits WHERE store_id = ?',
  );
  const delStoreStmt = connection.prepare('DELETE FROM stores WHERE id = ?');

  const apply = connection.transaction(() => {
    for (const id of markIds) markStmt.run(id);
    for (const id of deleteIds) {
      delVisitsStmt.run(id); // FK: clear dependent visits first
      delStoreStmt.run(id);
    }
    connection
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(CLEANUP_FLAG, new Date().toISOString());
  });
  apply();

  const valid = (
    connection
      .prepare('SELECT COUNT(*) AS n FROM stores WHERE is_irrelevant = 0')
      .get() as { n: number }
  ).n;

  console.log(
    `[vaidyaroute] relevance cleanup: marked ${markIds.length} irrelevant, ` +
      `deleted ${deleteIds.length}, ${valid} valid candidates remain.`,
  );
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type { StoreCategory, VisitOutcome } from './types';
import type { StoreCategory } from './types';

export interface StoreRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  category: StoreCategory | null;
  google_rating: number | null;
  hours_json: string | null;
  types_json: string | null;
  relevance_score: number | null; // 0-10 ayurvedic-prospect relevance
  discovered_at: string;
  refreshed_at: string;
  force_include: number; // 0 | 1
  is_irrelevant: number; // 0 | 1
  skipped_until: string | null; // YYYY-MM-DD this store is suppressed until
}

export interface VisitRow {
  id: number;
  store_id: string;
  visited_at: string;
  // Free-form: one of the preset VisitOutcome values or a custom string.
  outcome: string;
  notes: string | null;
  next_visit_date: string | null;
}

export interface RouteRow {
  id: number;
  date: string;
  store_ids_json: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
// Thin, typed wrappers around prepared statements. The API layer (Step 4) calls
// these instead of writing SQL inline.

/** Insert a store or update it in place if the Place ID already exists. */
export function upsertStore(store: {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string | null;
  category?: StoreCategory | null;
  google_rating?: number | null;
  hours_json?: string | null;
  types_json?: string | null;
  relevance_score?: number | null;
}): void {
  db.prepare(
    `INSERT INTO stores (id, name, address, lat, lng, phone, category, google_rating, hours_json, types_json, relevance_score, refreshed_at)
     VALUES (@id, @name, @address, @lat, @lng, @phone, @category, @google_rating, @hours_json, @types_json, @relevance_score, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       address = excluded.address,
       lat = excluded.lat,
       lng = excluded.lng,
       phone = excluded.phone,
       category = excluded.category,
       google_rating = excluded.google_rating,
       hours_json = excluded.hours_json,
       types_json = excluded.types_json,
       relevance_score = excluded.relevance_score,
       refreshed_at = datetime('now')`,
  ).run({
    phone: null,
    category: null,
    google_rating: null,
    hours_json: null,
    types_json: null,
    relevance_score: null,
    ...store,
  });
}

export function getAllStores(): StoreRow[] {
  return db.prepare('SELECT * FROM stores ORDER BY name').all() as StoreRow[];
}

/**
 * Stores eligible for routing: not flagged irrelevant and scored at/above the
 * relevance threshold. Unscored rows (NULL) are treated as eligible so a store
 * is never silently dropped before the backfill/discovery has scored it.
 */
export function getActiveStores(): StoreRow[] {
  return db
    .prepare(
      `SELECT * FROM stores
       WHERE is_irrelevant = 0
         AND COALESCE(relevance_score, ?) >= ?
       ORDER BY name`,
    )
    .all(MIN_RELEVANCE_SCORE, MIN_RELEVANCE_SCORE) as StoreRow[];
}

/**
 * "Skip today": suppress a store until the given date (exclusive). Pass null to
 * un-skip. Typically set to tomorrow so the store reappears the next day.
 */
export function setSkippedUntil(id: string, until: string | null): void {
  db.prepare('UPDATE stores SET skipped_until = ? WHERE id = ?').run(until, id);
}

/**
 * Store IDs currently skipped: skipped_until is today or later. "Skip for
 * today" sets skipped_until = today, so the store is excluded today and
 * re-enters the pool tomorrow.
 */
export function getSkippedStoreIds(today: string): string[] {
  const rows = db
    .prepare('SELECT id FROM stores WHERE skipped_until IS NOT NULL AND skipped_until >= ?')
    .all(today) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Permanently include/exclude a store from all future routes. */
export function setIrrelevant(id: string, irrelevant: boolean): void {
  // Marking irrelevant also clears any "force include" pin so the two flags
  // never contradict each other.
  if (irrelevant) {
    db.prepare(
      'UPDATE stores SET is_irrelevant = 1, force_include = 0 WHERE id = ?',
    ).run(id);
  } else {
    db.prepare('UPDATE stores SET is_irrelevant = 0 WHERE id = ?').run(id);
  }
}

/** Pin (or unpin) a store so it's forced into tonight's route. */
export function setForceInclude(id: string, force: boolean): void {
  db.prepare('UPDATE stores SET force_include = ? WHERE id = ?').run(
    force ? 1 : 0,
    id,
  );
}

/** Place IDs the user has pinned for tonight. */
export function getForceIncludedStoreIds(): string[] {
  const rows = db
    .prepare('SELECT id FROM stores WHERE force_include = 1')
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

/** How many stores were refreshed within the last `days` days. */
export function countFreshStores(days: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM stores WHERE refreshed_at > datetime('now', ?)`,
    )
    .get(`-${days} days`) as { n: number };
  return row.n;
}

export function getStore(id: string): StoreRow | undefined {
  return db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as StoreRow | undefined;
}

/** Place IDs whose data is older than `maxAgeDays` (or never refreshed). */
export function getStaleStoreIds(maxAgeDays: number): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM stores
       WHERE refreshed_at IS NULL
          OR refreshed_at <= datetime('now', ?)`,
    )
    .all(`-${maxAgeDays} days`) as { id: string }[];
  return rows.map((r) => r.id);
}

export function insertVisit(visit: {
  store_id: string;
  outcome: string;
  notes?: string | null;
  next_visit_date?: string | null;
}): VisitRow {
  const result = db
    .prepare(
      `INSERT INTO visits (store_id, outcome, notes, next_visit_date)
       VALUES (@store_id, @outcome, @notes, @next_visit_date)`,
    )
    .run({ notes: null, next_visit_date: null, ...visit });
  return db
    .prepare('SELECT * FROM visits WHERE id = ?')
    .get(result.lastInsertRowid) as VisitRow;
}

/** Map of store_id -> that store's most recent visit. */
export function getLatestVisitsByStore(): Map<string, VisitRow> {
  const rows = db
    .prepare(
      `SELECT v.* FROM visits v
       JOIN (
         SELECT store_id, MAX(visited_at) AS max_at, MAX(id) AS max_id
         FROM visits GROUP BY store_id
       ) latest
         ON v.store_id = latest.store_id
        AND v.id = latest.max_id`,
    )
    .all() as VisitRow[];
  return new Map(rows.map((r) => [r.store_id, r]));
}

export function getVisitsForStore(storeId: string): VisitRow[] {
  return db
    .prepare('SELECT * FROM visits WHERE store_id = ? ORDER BY visited_at DESC')
    .all(storeId) as VisitRow[];
}

export function getAllVisits(): VisitRow[] {
  return db.prepare('SELECT * FROM visits ORDER BY visited_at DESC').all() as VisitRow[];
}

export interface VisitWithStore extends VisitRow {
  store_name: string;
  store_address: string;
}

/** All visits, newest first, with the store's name/address for display. */
export function getVisitsWithStore(): VisitWithStore[] {
  return db
    .prepare(
      `SELECT v.*,
              COALESCE(s.name, '(deleted store)') AS store_name,
              COALESCE(s.address, '') AS store_address
       FROM visits v
       LEFT JOIN stores s ON s.id = v.store_id
       ORDER BY v.visited_at DESC`,
    )
    .all() as VisitWithStore[];
}

import type { FollowUp } from './types';

/**
 * Stores whose most recent visit scheduled a follow-up for exactly `date`.
 * Used for the "Follow-up today" banners on the main page.
 */
export function getFollowUpsForDate(date: string): FollowUp[] {
  return db
    .prepare(
      `SELECT v.store_id AS store_id,
              COALESCE(s.name, '(deleted store)') AS store_name,
              v.notes AS notes,
              v.next_visit_date AS next_visit_date
       FROM visits v
       JOIN (
         SELECT store_id, MAX(id) AS max_id FROM visits GROUP BY store_id
       ) latest ON v.id = latest.max_id
       LEFT JOIN stores s ON s.id = v.store_id
       WHERE v.next_visit_date = ?
       ORDER BY store_name`,
    )
    .all(date) as FollowUp[];
}

/** Store IDs visited within the last `days` days — excluded from new routes. */
export function getRecentlyVisitedStoreIds(days: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT store_id FROM visits
       WHERE visited_at >= datetime('now', ?)`,
    )
    .all(`-${days} days`) as { store_id: string }[];
  return rows.map((r) => r.store_id);
}

export function getRouteForDate(date: string): RouteRow | undefined {
  return db
    .prepare('SELECT * FROM routes WHERE date = ? ORDER BY generated_at DESC LIMIT 1')
    .get(date) as RouteRow | undefined;
}

export function saveRoute(date: string, storeIds: string[]): RouteRow {
  const result = db
    .prepare('INSERT INTO routes (date, store_ids_json) VALUES (?, ?)')
    .run(date, JSON.stringify(storeIds));
  return db
    .prepare('SELECT * FROM routes WHERE id = ?')
    .get(result.lastInsertRowid) as RouteRow;
}

/** Remove all saved routes for a date so the next request regenerates fresh. */
export function deleteRoutesForDate(date: string): number {
  return db.prepare('DELETE FROM routes WHERE date = ?').run(date).changes;
}

/**
 * Clear cached stores when the starting point moves to a new area, WITHOUT
 * losing the user's history: visited stores and all their visits are kept (so
 * the History page and store timelines stay intact), only unvisited stores and
 * the saved routes are removed. New-city discovery then repopulates the pool;
 * the retained out-of-area visited stores are far from the new origin and so
 * never surface in the nearby clusters.
 */
export function resetForNewLocation(): { storesDeleted: number } {
  const result = { storesDeleted: 0 };
  const tx = db.transaction(() => {
    result.storesDeleted = db
      .prepare(
        `DELETE FROM stores
         WHERE id NOT IN (
           SELECT DISTINCT store_id FROM visits WHERE store_id IS NOT NULL
         )`,
      )
      .run().changes;
    db.prepare('DELETE FROM routes').run();
  });
  tx();
  return result;
}

// ---------------------------------------------------------------------------
// Settings (key/value)
// ---------------------------------------------------------------------------

export const SETTING_KEYS = {
  startingAddress: 'starting_address',
  visitStart: 'visit_time_start',
  visitEnd: 'visit_time_end',
  lastDiscoveryLocation: 'last_discovery_location',
} as const;

export const DEFAULT_VISIT_START = '17:00';
export const DEFAULT_VISIT_END = '20:00';

export function getSetting(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

/** Saved starting address, or null if the user hasn't set one yet. */
export function getStartingAddress(): string | null {
  const v = getSetting(SETTING_KEYS.startingAddress);
  return v && v.trim().length > 0 ? v : null;
}

export function setStartingAddress(address: string): void {
  setSetting(SETTING_KEYS.startingAddress, address.trim());
}

/** Visit window (HH:MM), falling back to the 17:00–20:00 default. */
export function getVisitWindow(): { start: string; end: string } {
  return {
    start: getSetting(SETTING_KEYS.visitStart) || DEFAULT_VISIT_START,
    end: getSetting(SETTING_KEYS.visitEnd) || DEFAULT_VISIT_END,
  };
}

export function setVisitWindow(start: string, end: string): void {
  setSetting(SETTING_KEYS.visitStart, start);
  setSetting(SETTING_KEYS.visitEnd, end);
}

/** Lat/lng of the last discovery run, or null if discovery hasn't run yet. */
export function getLastDiscoveryLocation(): { lat: number; lng: number } | null {
  const raw = getSetting(SETTING_KEYS.lastDiscoveryLocation);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.lat === 'number' && typeof v?.lng === 'number') {
      return { lat: v.lat, lng: v.lng };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setLastDiscoveryLocation(lat: number, lng: number): void {
  setSetting(SETTING_KEYS.lastDiscoveryLocation, JSON.stringify({ lat, lng }));
}
