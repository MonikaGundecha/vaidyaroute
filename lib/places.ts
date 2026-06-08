import {
  upsertStore,
  getActiveStores,
  getStartingAddress,
  getVisitWindow,
  type StoreCategory,
  type StoreRow,
} from './db';
import { scoreRelevance, MIN_RELEVANCE_SCORE } from './relevance';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// How far around the starting address to look for prospects (meters).
const DISCOVERY_RADIUS_METERS = 8000;
// Up to 20 results per text query (the API max for a single page).
const MAX_RESULTS_PER_QUERY = 20;

// Search terms from the brief. The value is the category we assign to matches
// found via that term (a place found by several terms keeps the last write,
// then gets refined by its Google place types in `refineCategory`).
const SEARCH_TERMS: { query: string; category: StoreCategory }[] = [
  { query: 'ayurvedic store', category: 'wellness' },
  { query: 'indian grocery store', category: 'indian_grocery' },
  { query: 'south asian grocery', category: 'indian_grocery' },
  { query: 'desi grocery', category: 'indian_grocery' },
  { query: 'health food store', category: 'health_food' },
  { query: 'organic food store', category: 'health_food' },
  { query: 'yoga studio', category: 'yoga_studio' },
  { query: 'wellness center', category: 'wellness' },
  { query: 'holistic health', category: 'wellness' },
  { query: 'meditation center', category: 'wellness' },
  { query: 'pilates studio', category: 'yoga_studio' },
  { query: 'naturopath', category: 'wellness' },
  { query: 'acupuncture clinic', category: 'wellness' },
  { query: 'herbal medicine store', category: 'health_food' },
  { query: 'vitamin supplement store', category: 'health_food' },
  { query: 'ayurveda wellness', category: 'wellness' },
  { query: 'integrative medicine', category: 'wellness' },
];

// ---------------------------------------------------------------------------
// Relevance filtering — drop places that can't be ayurvedic-product prospects.
// ---------------------------------------------------------------------------

// Google place types that are never relevant. A place is dropped if any of its
// types is in this set. `pharmacy` is special-cased below (kept if ayurvedic).
const BLOCKED_PLACE_TYPES = new Set<string>([
  'lodging',
  'real_estate_agency',
  'finance',
  'bank',
  'atm',
  'car_dealer',
  'car_repair',
  'car_wash',
  'gas_station',
  'parking',
  'airport',
  'transit_station',
  'subway_station',
  'hospital',
  'dentist',
  'doctor',
  'school',
  'university',
  'courthouse',
  'embassy',
  'funeral_home',
  'cemetery',
  'place_of_worship',
  // Food service — restaurants/cafes/bars are not product retail prospects.
  'restaurant',
  'food',
  'bar',
  'night_club',
  'cafe',
  'bakery',
  'meal_delivery',
  'meal_takeaway',
]);

// Name fragments (lowercased) that indicate a hotel/residence, not a prospect.
const BLOCKED_NAME_WORDS = [
  'hotel',
  'residence',
  'apartments',
  'suites',
  'inn',
  'ritz',
  'marriott',
  'hilton',
  'hyatt',
  'tower residences',
];

/**
 * True if a place should be excluded from discovery based on its Google types
 * or name. Pharmacies are allowed only when the name reads as ayurvedic.
 */
export function isBlockedPlace(
  name: string,
  types: string[] | undefined,
): boolean {
  const lowerName = name.toLowerCase();
  const isAyurvedic = lowerName.includes('ayurved');

  if (types?.length) {
    for (const t of types) {
      if (BLOCKED_PLACE_TYPES.has(t)) return true;
      if (t === 'pharmacy' && !isAyurvedic) return true;
    }
  }

  // Ayurvedic shops are always wanted even if their name happens to match.
  if (isAyurvedic) return false;
  return BLOCKED_NAME_WORDS.some((w) => lowerName.includes(w));
}

/** Returns the Google Maps API key or throws if it's missing/placeholder. */
export function requireMapsApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || key === 'your_key_here') {
    throw new PlacesError(
      'GOOGLE_MAPS_API_KEY is not set in .env.local — cannot query Google.',
    );
  }
  return key;
}

/** User-configured starting address (Settings page). Throws if none is set. */
async function startingAddress(): Promise<string> {
  const addr = await getStartingAddress();
  if (!addr) {
    throw new PlacesError(
      'No starting address set — add one on the Settings page before generating a route.',
    );
  }
  return addr;
}

/** Thrown for any Google API failure so callers can fall back to cached data. */
export class PlacesError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PlacesError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Places API (New) response shapes — only the fields we request.
// ---------------------------------------------------------------------------

export interface OpeningHoursPoint {
  day: number; // 0 = Sunday .. 6 = Saturday
  hour: number;
  minute: number;
}

export interface OpeningHoursPeriod {
  open: OpeningHoursPoint;
  close?: OpeningHoursPoint; // absent => open 24h from `open`
}

export interface RegularOpeningHours {
  openNow?: boolean;
  periods?: OpeningHoursPeriod[];
  weekdayDescriptions?: string[];
}

interface PlaceResult {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  rating?: number;
  regularOpeningHours?: RegularOpeningHours;
  types?: string[];
}

interface SearchTextResponse {
  places?: PlaceResult[];
  error?: { message?: string; status?: string };
}

// ---------------------------------------------------------------------------
// Geocoding (starting address -> coordinates, used to bias searches)
// ---------------------------------------------------------------------------

// Cache keyed by address so changing the starting address (Settings) doesn't
// keep returning stale coordinates.
let cachedOrigin: { address: string; lat: number; lng: number } | null = null;

export async function getStartingCoordinates(): Promise<{
  lat: number;
  lng: number;
}> {
  const address = await startingAddress();
  if (cachedOrigin && cachedOrigin.address === address) {
    return { lat: cachedOrigin.lat, lng: cachedOrigin.lng };
  }

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('key', requireMapsApiKey());

  let json: {
    status: string;
    results: { geometry: { location: { lat: number; lng: number } } }[];
    error_message?: string;
  };
  try {
    const res = await fetch(url, { cache: 'no-store' });
    json = await res.json();
  } catch (err) {
    throw new PlacesError('Geocoding request failed', err);
  }

  if (json.status !== 'OK' || !json.results?.length) {
    throw new PlacesError(
      `Geocoding failed for "${address}": ${json.status}${
        json.error_message ? ` — ${json.error_message}` : ''
      }`,
    );
  }

  const loc = json.results[0].geometry.location;
  cachedOrigin = { address, lat: loc.lat, lng: loc.lng };
  return { lat: loc.lat, lng: loc.lng };
}

// ---------------------------------------------------------------------------
// Text Search (New)
// ---------------------------------------------------------------------------

async function searchText(
  query: string,
  origin: { lat: number; lng: number },
): Promise<PlaceResult[]> {
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.nationalPhoneNumber',
    'places.rating',
    'places.regularOpeningHours',
    'places.types',
  ].join(',');

  let json: SearchTextResponse;
  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': requireMapsApiKey(),
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: MAX_RESULTS_PER_QUERY,
        locationBias: {
          circle: {
            center: { latitude: origin.lat, longitude: origin.lng },
            radius: DISCOVERY_RADIUS_METERS,
          },
        },
      }),
    });
    json = await res.json();
    if (!res.ok) {
      throw new PlacesError(
        `Places search "${query}" failed (${res.status}): ${
          json.error?.message ?? 'unknown error'
        }`,
      );
    }
  } catch (err) {
    if (err instanceof PlacesError) throw err;
    throw new PlacesError(`Places search "${query}" request failed`, err);
  }

  return json.places ?? [];
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Prefer an unambiguous Google place type over the search-term-derived
 * category. Google's type set is inconsistent for "wellness", so we only
 * override for the types we trust.
 */
function refineCategory(
  fallback: StoreCategory,
  types: string[] | undefined,
): StoreCategory {
  if (!types?.length) return fallback;
  if (types.includes('spa')) return 'spa';
  if (types.includes('yoga_studio')) return 'yoga_studio';
  if (types.includes('gym') || types.includes('fitness_center')) return 'gym';
  if (
    types.includes('health') ||
    types.includes('grocery_store') ||
    types.includes('supermarket')
  ) {
    // Only downgrade to health_food if we don't already have a more specific
    // wellness/yoga classification.
    if (fallback === 'other') return 'health_food';
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  queriesRun: number;
  uniquePlaces: number;
  upserted: number;
}

/**
 * Run every search term near the starting address, dedupe by Place ID, and
 * upsert each result into the `stores` table. Returns a summary.
 */
export async function discoverStores(): Promise<DiscoveryResult> {
  const origin = await getStartingCoordinates();

  // Place ID -> { place, category }. First category wins for the row, but we
  // run refineCategory at write time so place types get the final say.
  const found = new Map<string, { place: PlaceResult; category: StoreCategory }>();

  for (const term of SEARCH_TERMS) {
    const results = await searchText(term.query, origin);
    for (const place of results) {
      if (!place.id || !place.location) continue;
      if (!found.has(place.id)) {
        found.set(place.id, { place, category: term.category });
      }
    }
  }

  // Score each candidate and only keep genuinely relevant prospects (>= 7).
  let upserted = 0;
  for (const { place, category } of Array.from(found.values())) {
    if (!place.location) continue;
    const name = place.displayName?.text ?? '(unnamed)';
    const refined = refineCategory(category, place.types);
    const score = scoreRelevance(name, place.types, refined);
    if (score < MIN_RELEVANCE_SCORE) continue;

    await upsertStore({
      id: place.id,
      name,
      address: place.formattedAddress ?? '',
      lat: place.location.latitude,
      lng: place.location.longitude,
      phone: place.nationalPhoneNumber ?? null,
      category: refined,
      google_rating: place.rating ?? null,
      hours_json: place.regularOpeningHours
        ? JSON.stringify(place.regularOpeningHours)
        : null,
      types_json: place.types?.length ? JSON.stringify(place.types) : null,
      relevance_score: score,
    });
    upserted += 1;
  }

  return {
    queriesRun: SEARCH_TERMS.length,
    uniquePlaces: found.size,
    upserted,
  };
}

// ---------------------------------------------------------------------------
// Evening-hours filter
// ---------------------------------------------------------------------------

function parseHHMM(value: string | undefined, fallback: string): number {
  const [h, m] = (value ?? fallback).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Absolute minute-of-week for a {day, hour, minute} point (Sun=0). */
function pointToWeekMinute(p: OpeningHoursPoint): number {
  return p.day * 1440 + p.hour * 60 + p.minute;
}

/**
 * Does this store have any opening period that overlaps the evening window on
 * the given day? `hoursJson` is the raw `regularOpeningHours` we stored.
 */
export function isOpenDuringWindow(
  hoursJson: string | null,
  date: Date,
  startHHMM?: string,
  endHHMM?: string,
): boolean {
  if (!hoursJson) return false;

  let hours: RegularOpeningHours;
  try {
    hours = JSON.parse(hoursJson);
  } catch {
    return false;
  }
  const periods = hours.periods;
  if (!periods?.length) return false;

  const targetDay = date.getDay(); // 0 = Sunday, matches Google's `day`
  const winStart = parseHHMM(startHHMM, '17:00');
  const winEnd = parseHHMM(endHHMM, '20:00');

  const winStartAbs = targetDay * 1440 + winStart;
  const winEndAbs = targetDay * 1440 + winEnd;
  const WEEK = 7 * 1440;

  for (const period of periods) {
    // A period with `open` but no `close` means open 24 hours (Google sets a
    // single period of open day 0 00:00 with no close for 24/7 places).
    if (!period.close) return true;

    const openAbs = pointToWeekMinute(period.open);
    let closeAbs = pointToWeekMinute(period.close);
    // Period that closes "before" it opens wraps past the end of the week.
    if (closeAbs <= openAbs) closeAbs += WEEK;

    // Test the period as-is and shifted back one week, so a Sat->Sun wrap that
    // lands on our target day is still caught.
    for (const shift of [0, -WEEK]) {
      const o = openAbs + shift;
      const c = closeAbs + shift;
      if (o < winEndAbs && c > winStartAbs) return true;
    }
  }

  return false;
}

function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, '0');
  return minute === 0 ? `${h12} ${period}` : `${h12}:${mm} ${period}`;
}

/**
 * Human label for when the store closes on the given day, e.g. "8 PM" or
 * "24 hours". Picks the period that opens on the target day and closes latest;
 * returns null if we have no usable hours for that day.
 */
export function getTodayCloseLabel(
  hoursJson: string | null,
  date: Date = new Date(),
): string | null {
  if (!hoursJson) return null;
  let hours: RegularOpeningHours;
  try {
    hours = JSON.parse(hoursJson);
  } catch {
    return null;
  }
  const periods = hours.periods;
  if (!periods?.length) return null;

  const targetDay = date.getDay();
  let best: OpeningHoursPoint | null = null;
  let bestClose = -1;

  for (const period of periods) {
    if (!period.close) return '24 hours'; // open with no close => 24/7
    if (period.open.day !== targetDay) continue;
    const closeMin = period.close.hour * 60 + period.close.minute;
    // Treat a close that wraps to the next day as "late" so it wins.
    const rank = period.close.day !== targetDay ? closeMin + 1440 : closeMin;
    if (rank > bestClose) {
      bestClose = rank;
      best = period.close;
    }
  }

  return best ? formatClock(best.hour, best.minute) : null;
}

/**
 * Google's human-readable per-day opening hours (e.g. "Monday: 9 AM – 8 PM"),
 * or null if we have none stored. Used on the store detail page.
 */
export function getWeekdayHours(hoursJson: string | null): string[] | null {
  if (!hoursJson) return null;
  try {
    const hours = JSON.parse(hoursJson) as RegularOpeningHours;
    return hours.weekdayDescriptions?.length ? hours.weekdayDescriptions : null;
  } catch {
    return null;
  }
}

/**
 * Filter stored rows to those open during tonight's window. Pass a specific
 * date to test a different day; defaults to now.
 */
export function filterOpenTonight(
  stores: StoreRow[],
  date: Date = new Date(),
  window?: { start: string; end: string },
): StoreRow[] {
  const w = window ?? { start: '17:00', end: '20:00' };
  return stores.filter((s) =>
    isOpenDuringWindow(s.hours_json, date, w.start, w.end),
  );
}

/** Convenience: all routable stores that are open during tonight's window. */
export async function getOpenStoresTonight(
  date: Date = new Date(),
): Promise<StoreRow[]> {
  const [stores, window] = await Promise.all([
    getActiveStores(),
    getVisitWindow(),
  ]);
  return filterOpenTonight(stores, date, window);
}
