import { createClient, type Client, type ResultSet } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { scoreRelevance, MIN_RELEVANCE_SCORE } from './relevance';

// ---------------------------------------------------------------------------
// Connection (Turso / LibSQL)
// ---------------------------------------------------------------------------
// In production set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN). With neither set we
// fall back to a local SQLite file so dev works without a hosted database.
// The client + the one-time migration promise are stashed on globalThis so
// Next.js hot-reloads reuse a single connection.

const DB_DIR = path.join(process.cwd(), 'data');

const globalForDb = globalThis as unknown as {
  __vaidyaClient?: Client;
  __vaidyaMigrated?: Promise<void>;
};

function localFileUrl(): string {
  fs.mkdirSync(DB_DIR, { recursive: true });
  return `file:${path.join(DB_DIR, 'vaidyaroute.db')}`;
}

function rawClient(): Client {
  if (globalForDb.__vaidyaClient) return globalForDb.__vaidyaClient;
  const envUrl = process.env.TURSO_DATABASE_URL?.trim();
  const url = envUrl && envUrl.length > 0 ? envUrl : localFileUrl();
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const c = createClient({ url, authToken });
  globalForDb.__vaidyaClient = c;
  return c;
}

/** Get the client, running (and awaiting) migrations exactly once. */
async function client(): Promise<Client> {
  const c = rawClient();
  // Cache the migration promise so concurrent requests share one run. If it
  // rejects (e.g. a transient Turso error on a cold start) we must NOT keep the
  // rejected promise around — a poisoned cache would make every later DB write
  // reject forever. Clear it on failure so the next call retries.
  if (!globalForDb.__vaidyaMigrated) {
    globalForDb.__vaidyaMigrated = migrate(c).catch((err) => {
      globalForDb.__vaidyaMigrated = undefined;
      throw err;
    });
  }
  await globalForDb.__vaidyaMigrated;
  return c;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function many<T>(rs: ResultSet): T[] {
  return rs.rows as unknown as T[];
}
function one<T>(rs: ResultSet): T | undefined {
  return rs.rows[0] as unknown as T | undefined;
}

// ---------------------------------------------------------------------------
// Relevance-cleanup blocklists (used by the one-time data cleanup)
// ---------------------------------------------------------------------------

const CLEANUP_BLOCKED_TYPES = new Set<string>([
  'lodging', 'real_estate_agency', 'finance', 'bank', 'atm', 'car_dealer',
  'car_repair', 'car_wash', 'gas_station', 'parking', 'airport',
  'transit_station', 'subway_station', 'hospital', 'dentist', 'doctor',
  'pharmacy', 'school', 'university', 'courthouse', 'embassy', 'funeral_home',
  'cemetery', 'place_of_worship', 'restaurant', 'food', 'bar', 'night_club',
  'cafe', 'bakery', 'meal_delivery', 'meal_takeaway',
]);

const CLEANUP_NAME_RE =
  /\b(hotel|residence|residences|apartments|suites|inn|ritz|marriott|hilton|hyatt|restaurant|bistro|bar|cafe|café|bakery|grill|pizza|burger|sushi|diner|cantina)\b/i;

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

async function migrate(c: Client): Promise<void> {
  await c.executeMultiple(`
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
  `);

  // --- Guarded column additions for DBs created before a column existed.
  const cols = many<{ name: string }>(
    await c.execute('PRAGMA table_info(stores)'),
  ).map((r) => r.name);
  const addColumn = async (name: string, ddl: string) => {
    if (!cols.includes(name)) await c.execute(`ALTER TABLE stores ADD COLUMN ${ddl}`);
  };
  await addColumn('force_include', 'force_include INTEGER NOT NULL DEFAULT 0');
  await addColumn('is_irrelevant', 'is_irrelevant INTEGER NOT NULL DEFAULT 0');
  await addColumn('skipped_until', 'skipped_until TEXT');
  await addColumn('types_json', 'types_json TEXT');
  await addColumn('relevance_score', 'relevance_score INTEGER');

  // --- Rebuild visits without the old CHECK(outcome) constraint if present.
  const visitsTable = one<{ sql: string }>(
    await c.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='visits'",
    ),
  );
  if (visitsTable && /CHECK\s*\(\s*outcome/i.test(visitsTable.sql)) {
    await c.executeMultiple(`
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
    `);
  }

  await runIrrelevanceCleanup(c);
  await runRelevanceBackfill(c);
}

// ---------------------------------------------------------------------------
// One-time relevance cleanup of legacy/dirty store data
// ---------------------------------------------------------------------------

async function flagDone(c: Client, key: string): Promise<boolean> {
  const row = one<{ value: string }>(
    await c.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] }),
  );
  return Boolean(row);
}
async function setFlag(c: Client, key: string): Promise<void> {
  await c.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, new Date().toISOString()],
  });
}

async function runIrrelevanceCleanup(c: Client): Promise<void> {
  const FLAG = 'irrelevance_cleanup_v1';
  if (await flagDone(c, FLAG)) return;

  const rows = many<{
    id: string;
    name: string;
    category: string | null;
    types_json: string | null;
    is_irrelevant: number;
  }>(
    await c.execute(
      'SELECT id, name, category, types_json, is_irrelevant FROM stores',
    ),
  );

  const markIds: string[] = [];
  const deleteIds: string[] = [];
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
    const typeBlocked = types.some((t) => CLEANUP_BLOCKED_TYPES.has(t));
    const nameBlocked = CLEANUP_NAME_RE.test(r.name);
    if (r.category == null && nameBlocked) {
      deleteIds.push(r.id);
      continue;
    }
    if ((typeBlocked || nameBlocked) && r.is_irrelevant !== 1) markIds.push(r.id);
  }

  const stmts = [
    ...markIds.map((id) => ({
      sql: 'UPDATE stores SET is_irrelevant = 1 WHERE id = ?',
      args: [id],
    })),
    ...deleteIds.flatMap((id) => [
      { sql: 'DELETE FROM visits WHERE store_id = ?', args: [id] },
      { sql: 'DELETE FROM stores WHERE id = ?', args: [id] },
    ]),
  ];
  if (stmts.length) await c.batch(stmts, 'write');
  await setFlag(c, FLAG);

  const valid = one<{ n: number }>(
    await c.execute('SELECT COUNT(*) AS n FROM stores WHERE is_irrelevant = 0'),
  )?.n;
  console.log(
    `[vaidyaroute] relevance cleanup: marked ${markIds.length} irrelevant, ` +
      `deleted ${deleteIds.length}, ${valid ?? '?'} valid candidates remain.`,
  );
}

async function runRelevanceBackfill(c: Client): Promise<void> {
  const FLAG = 'relevance_score_v1';
  if (await flagDone(c, FLAG)) return;

  const rows = many<{
    id: string;
    name: string;
    category: string | null;
    types_json: string | null;
  }>(await c.execute('SELECT id, name, category, types_json FROM stores'));

  let kept = 0;
  const stmts = rows.map((r) => {
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
    if (score >= MIN_RELEVANCE_SCORE) kept += 1;
    return {
      sql: 'UPDATE stores SET relevance_score = ? WHERE id = ?',
      args: [score, r.id],
    };
  });
  if (stmts.length) await c.batch(stmts, 'write');
  await setFlag(c, FLAG);

  console.log(
    `[vaidyaroute] relevance backfill: scored ${rows.length} stores, ` +
      `${kept} at/above threshold (${MIN_RELEVANCE_SCORE}).`,
  );
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type { StoreCategory, VisitOutcome } from './types';
import type { StoreCategory, FollowUp } from './types';

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
  relevance_score: number | null;
  discovered_at: string;
  refreshed_at: string;
  force_include: number; // 0 | 1
  is_irrelevant: number; // 0 | 1
  skipped_until: string | null;
}

export interface VisitRow {
  id: number;
  store_id: string;
  visited_at: string;
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
// Stores
// ---------------------------------------------------------------------------

export async function upsertStore(store: {
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
}): Promise<void> {
  const c = await client();
  await c.execute({
    sql: `INSERT INTO stores (id, name, address, lat, lng, phone, category, google_rating, hours_json, types_json, relevance_score, refreshed_at)
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
    args: {
      phone: null,
      category: null,
      google_rating: null,
      hours_json: null,
      types_json: null,
      relevance_score: null,
      ...store,
    },
  });
}

export async function getAllStores(): Promise<StoreRow[]> {
  const c = await client();
  return many<StoreRow>(await c.execute('SELECT * FROM stores ORDER BY name'));
}

/**
 * Stores eligible for routing: not flagged irrelevant and scored at/above the
 * relevance threshold (NULL scores treated as eligible so a store is never
 * dropped before backfill/discovery has scored it).
 */
export async function getActiveStores(): Promise<StoreRow[]> {
  const c = await client();
  return many<StoreRow>(
    await c.execute({
      sql: `SELECT * FROM stores
            WHERE is_irrelevant = 0 AND COALESCE(relevance_score, ?) >= ?
            ORDER BY name`,
      args: [MIN_RELEVANCE_SCORE, MIN_RELEVANCE_SCORE],
    }),
  );
}

/** "Skip for today": suppress until the given date (today). null to un-skip. */
export async function setSkippedUntil(id: string, until: string | null): Promise<void> {
  const c = await client();
  await c.execute({
    sql: 'UPDATE stores SET skipped_until = ? WHERE id = ?',
    args: [until, id],
  });
}

/** Store IDs currently skipped: skipped_until is today or later. */
export async function getSkippedStoreIds(today: string): Promise<string[]> {
  const c = await client();
  const rows = many<{ id: string }>(
    await c.execute({
      sql: 'SELECT id FROM stores WHERE skipped_until IS NOT NULL AND skipped_until >= ?',
      args: [today],
    }),
  );
  return rows.map((r) => r.id);
}

/** Permanently include/exclude a store from all future routes. */
export async function setIrrelevant(id: string, irrelevant: boolean): Promise<void> {
  const c = await client();
  if (irrelevant) {
    await c.execute({
      sql: 'UPDATE stores SET is_irrelevant = 1, force_include = 0 WHERE id = ?',
      args: [id],
    });
  } else {
    await c.execute({
      sql: 'UPDATE stores SET is_irrelevant = 0 WHERE id = ?',
      args: [id],
    });
  }
}

/** Pin (or unpin) a store so it's forced into tonight's route. */
export async function setForceInclude(id: string, force: boolean): Promise<void> {
  const c = await client();
  await c.execute({
    sql: 'UPDATE stores SET force_include = ? WHERE id = ?',
    args: [force ? 1 : 0, id],
  });
}

/** Place IDs the user has pinned for tonight. */
export async function getForceIncludedStoreIds(): Promise<string[]> {
  const c = await client();
  const rows = many<{ id: string }>(
    await c.execute('SELECT id FROM stores WHERE force_include = 1'),
  );
  return rows.map((r) => r.id);
}

/** How many stores were refreshed within the last `days` days. */
export async function countFreshStores(days: number): Promise<number> {
  const c = await client();
  const row = one<{ n: number }>(
    await c.execute({
      sql: `SELECT COUNT(*) AS n FROM stores WHERE refreshed_at > datetime('now', ?)`,
      args: [`-${days} days`],
    }),
  );
  return row?.n ?? 0;
}

export async function getStore(id: string): Promise<StoreRow | undefined> {
  const c = await client();
  return one<StoreRow>(
    await c.execute({ sql: 'SELECT * FROM stores WHERE id = ?', args: [id] }),
  );
}

/** Place IDs whose data is older than `maxAgeDays` (or never refreshed). */
export async function getStaleStoreIds(maxAgeDays: number): Promise<string[]> {
  const c = await client();
  const rows = many<{ id: string }>(
    await c.execute({
      sql: `SELECT id FROM stores WHERE refreshed_at IS NULL OR refreshed_at <= datetime('now', ?)`,
      args: [`-${maxAgeDays} days`],
    }),
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export async function insertVisit(visit: {
  store_id: string;
  outcome: string;
  notes?: string | null;
  next_visit_date?: string | null;
}): Promise<VisitRow> {
  const c = await client();
  const rs = await c.execute({
    sql: `INSERT INTO visits (store_id, outcome, notes, next_visit_date)
          VALUES (@store_id, @outcome, @notes, @next_visit_date)
          RETURNING *`,
    args: { notes: null, next_visit_date: null, ...visit },
  });
  return one<VisitRow>(rs)!;
}

/** Map of store_id -> that store's most recent visit. */
export async function getLatestVisitsByStore(): Promise<Map<string, VisitRow>> {
  const c = await client();
  const rows = many<VisitRow>(
    await c.execute(
      `SELECT v.* FROM visits v
       JOIN (
         SELECT store_id, MAX(id) AS max_id FROM visits GROUP BY store_id
       ) latest ON v.store_id = latest.store_id AND v.id = latest.max_id`,
    ),
  );
  return new Map(rows.map((r) => [r.store_id, r]));
}

export async function getVisitsForStore(storeId: string): Promise<VisitRow[]> {
  const c = await client();
  return many<VisitRow>(
    await c.execute({
      sql: 'SELECT * FROM visits WHERE store_id = ? ORDER BY visited_at DESC',
      args: [storeId],
    }),
  );
}

export async function getAllVisits(): Promise<VisitRow[]> {
  const c = await client();
  return many<VisitRow>(
    await c.execute('SELECT * FROM visits ORDER BY visited_at DESC'),
  );
}

export interface VisitWithStore extends VisitRow {
  store_name: string;
  store_address: string;
}

export async function getVisitsWithStore(): Promise<VisitWithStore[]> {
  const c = await client();
  return many<VisitWithStore>(
    await c.execute(
      `SELECT v.*,
              COALESCE(s.name, '(deleted store)') AS store_name,
              COALESCE(s.address, '') AS store_address
       FROM visits v
       LEFT JOIN stores s ON s.id = v.store_id
       ORDER BY v.visited_at DESC`,
    ),
  );
}

/** Store IDs visited within the last `days` days — excluded from new routes. */
export async function getRecentlyVisitedStoreIds(days: number): Promise<string[]> {
  const c = await client();
  const rows = many<{ store_id: string }>(
    await c.execute({
      sql: `SELECT DISTINCT store_id FROM visits WHERE visited_at >= datetime('now', ?)`,
      args: [`-${days} days`],
    }),
  );
  return rows.map((r) => r.store_id);
}

/** Stores whose most recent visit scheduled a follow-up for exactly `date`. */
export async function getFollowUpsForDate(date: string): Promise<FollowUp[]> {
  const c = await client();
  return many<FollowUp>(
    await c.execute({
      sql: `SELECT v.store_id AS store_id,
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
      args: [date],
    }),
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function getRouteForDate(date: string): Promise<RouteRow | undefined> {
  const c = await client();
  return one<RouteRow>(
    await c.execute({
      sql: 'SELECT * FROM routes WHERE date = ? ORDER BY generated_at DESC LIMIT 1',
      args: [date],
    }),
  );
}

export async function saveRoute(date: string, storeIds: string[]): Promise<RouteRow> {
  const c = await client();
  const rs = await c.execute({
    sql: 'INSERT INTO routes (date, store_ids_json) VALUES (?, ?) RETURNING *',
    args: [date, JSON.stringify(storeIds)],
  });
  return one<RouteRow>(rs)!;
}

/** Remove all saved routes for a date so the next request regenerates fresh. */
export async function deleteRoutesForDate(date: string): Promise<number> {
  const c = await client();
  const rs = await c.execute({
    sql: 'DELETE FROM routes WHERE date = ?',
    args: [date],
  });
  return Number(rs.rowsAffected);
}

/**
 * Clear cached stores when the starting point moves to a new area, keeping the
 * user's history: visited stores and all visits are kept, only unvisited stores
 * and the saved routes are removed.
 */
export async function resetForNewLocation(): Promise<{ storesDeleted: number }> {
  const c = await client();
  const rs = await c.batch(
    [
      {
        sql: `DELETE FROM stores
              WHERE id NOT IN (
                SELECT DISTINCT store_id FROM visits WHERE store_id IS NOT NULL
              )`,
      },
      { sql: 'DELETE FROM routes' },
    ],
    'write',
  );
  return { storesDeleted: Number(rs[0]?.rowsAffected ?? 0) };
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

export async function getSetting(key: string): Promise<string | null> {
  const c = await client();
  const row = one<{ value: string }>(
    await c.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] }),
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const c = await client();
  await c.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
}

export async function getStartingAddress(): Promise<string | null> {
  const v = await getSetting(SETTING_KEYS.startingAddress);
  return v && v.trim().length > 0 ? v : null;
}

export async function setStartingAddress(address: string): Promise<void> {
  await setSetting(SETTING_KEYS.startingAddress, address.trim());
}

export async function getVisitWindow(): Promise<{ start: string; end: string }> {
  const [start, end] = await Promise.all([
    getSetting(SETTING_KEYS.visitStart),
    getSetting(SETTING_KEYS.visitEnd),
  ]);
  return {
    start: start || DEFAULT_VISIT_START,
    end: end || DEFAULT_VISIT_END,
  };
}

export async function setVisitWindow(start: string, end: string): Promise<void> {
  await setSetting(SETTING_KEYS.visitStart, start);
  await setSetting(SETTING_KEYS.visitEnd, end);
}

export async function getLastDiscoveryLocation(): Promise<{ lat: number; lng: number } | null> {
  const raw = await getSetting(SETTING_KEYS.lastDiscoveryLocation);
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

export async function setLastDiscoveryLocation(lat: number, lng: number): Promise<void> {
  await setSetting(SETTING_KEYS.lastDiscoveryLocation, JSON.stringify({ lat, lng }));
}
