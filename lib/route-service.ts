import {
  getRouteForDate,
  saveRoute,
  getStore,
  getVisitsForStore,
  countFreshStores,
  getActiveStores,
  getStartingAddress,
  getLastDiscoveryLocation,
  setLastDiscoveryLocation,
  resetForNewLocation,
  type StoreRow,
} from './db';
import {
  getStartingCoordinates,
  getOpenStoresTonight,
  discoverStores,
  getTodayCloseLabel,
} from './places';
import type { RouteResponse, RouteStopResponse } from './types';
import {
  selectClusters,
  haversineMeters,
  todayString,
  type LatLng,
} from './clustering';
import {
  optimizeRoute,
  routeForOrderedStores,
  buildGoogleMapsDirectionsUrl,
  type OptimizedRoute,
  type TravelMode,
} from './routing';

/** Travel mode for the whole app. */
export const ROUTE_MODE: TravelMode = 'driving';
/** Re-run Places discovery only if nothing has been refreshed in this many days. */
const DISCOVERY_FRESHNESS_DAYS = 7;
/** A starting point this far (m) from the last discovery is a new location. */
const NEW_LOCATION_THRESHOLD_METERS = 10_000;

const startingAddress = () => getStartingAddress() ?? '';

const MODE_WORD: Record<TravelMode, string> = {
  driving: 'drive',
  walking: 'walk',
  bicycling: 'bike',
  transit: 'transit',
};

export type { RouteResponse, RouteStopResponse } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function singleStoreMapsUrl(s: StoreRow): string {
  return `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lng}`;
}

function stopFromStore(
  store: StoreRow,
  order: number,
  leg: { seconds: number; text: string; estimated: boolean },
  mode: TravelMode,
  forDate: Date,
): RouteStopResponse {
  const visits = getVisitsForStore(store.id);
  const label = leg.text === '—' ? '—' : `${leg.text} ${MODE_WORD[mode]}`;
  return {
    order,
    store: {
      id: store.id,
      name: store.name,
      address: store.address,
      phone: store.phone,
      category: store.category,
      rating: store.google_rating,
      lat: store.lat,
      lng: store.lng,
    },
    travel_from_previous: label,
    travel_seconds: leg.seconds,
    estimated: leg.estimated,
    maps_url: singleStoreMapsUrl(store),
    open_until: getTodayCloseLabel(store.hours_json, forDate),
    last_visit: visits[0]?.visited_at ?? null,
    outcome_history: visits.map((v) => ({
      outcome: v.outcome,
      visited_at: v.visited_at,
      notes: v.notes,
      next_visit_date: v.next_visit_date,
    })),
  };
}

function buildResponse(
  date: string,
  forDate: Date,
  route: OptimizedRoute,
  meta: {
    source: RouteResponse['source'];
    clusterIndex: number;
    alternativeCount: number;
    warning?: string;
  },
): RouteResponse {
  return {
    date,
    mode: route.mode,
    origin_address: startingAddress(),
    stops: route.stops.map((s) =>
      stopFromStore(s.store, s.order, s.travelFromPrevious, route.mode, forDate),
    ),
    total_estimated_time: route.totalTravelText,
    used_fallback: route.usedFallback,
    cluster_index: meta.clusterIndex,
    alternative_cluster_count: meta.alternativeCount,
    google_maps_directions_url: buildGoogleMapsDirectionsUrl(
      startingAddress(),
      route.stops.map((s) => s.store),
      route.mode,
    ),
    source: meta.source,
    warning: meta.warning,
  };
}

/** Build a degraded OptimizedRoute (no travel times) for a fixed store list. */
function degradedRoute(stores: StoreRow[], mode: TravelMode): OptimizedRoute {
  return {
    origin: { lat: 0, lng: 0 },
    mode,
    stops: stores.map((store, i) => ({
      order: i + 1,
      store,
      travelFromPrevious: { seconds: 0, text: '—', estimated: true },
    })),
    totalTravelSeconds: 0,
    totalTravelText: '—',
    usedFallback: true,
  };
}

/** Hard fallback (note 4): nearest cached stores when Google is unreachable. */
function fallbackResponse(
  date: string,
  forDate: Date,
  origin: LatLng | null,
  warning: string,
): RouteResponse {
  let stores = getActiveStores();
  if (origin) {
    stores = [...stores].sort(
      (a, b) =>
        haversineMeters(origin, { lat: a.lat, lng: a.lng }) -
        haversineMeters(origin, { lat: b.lat, lng: b.lng }),
    );
  } else {
    stores = [...stores].sort(
      (a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0),
    );
  }
  return buildResponse(date, forDate, degradedRoute(stores.slice(0, 4), ROUTE_MODE), {
    source: 'fallback',
    clusterIndex: 0,
    alternativeCount: 0,
    warning,
  });
}

/** Re-run discovery only if the cached store data has gone stale. */
async function ensureFreshStores(): Promise<void> {
  if (countFreshStores(DISCOVERY_FRESHNESS_DAYS) > 0) return;
  await discoverStores();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface GenerateRouteOptions {
  regenerate?: boolean;
  /** Which ranked cluster to use (for "Regenerate" cycling). Default 0. */
  index?: number;
  date?: Date;
}

export async function generateRoute(
  opts: GenerateRouteOptions = {},
): Promise<RouteResponse> {
  const date = opts.date ?? new Date();
  const dateStr = todayString(date);
  const regenerate = opts.regenerate ?? false;

  // No starting address configured → prompt the user to set one (Settings).
  if (!getStartingAddress()) {
    return {
      ...buildResponse(dateStr, date, degradedRoute([], ROUTE_MODE), {
        source: 'needs_setup',
        clusterIndex: 0,
        alternativeCount: 0,
        warning: 'Set your starting address in Settings to plan a route.',
      }),
      needs_setup: true,
    };
  }

  // Resolve origin first; if we can't even geocode, Google is unreachable.
  let origin: LatLng;
  try {
    origin = await getStartingCoordinates();
  } catch {
    return fallbackResponse(
      dateStr,
      date,
      null,
      'Could not reach Google to plan a route — showing cached stores by rating.',
    );
  }

  // If the starting point moved to a new area, the cached stores belong to the
  // old city — wipe them and rediscover so we never serve another city's data.
  const lastLoc = getLastDiscoveryLocation();
  let justDiscovered = false;
  if (!lastLoc) {
    // First run (or legacy DB): adopt the current origin without wiping the
    // existing data. Discovery still runs below if the pool is empty/stale.
    setLastDiscoveryLocation(origin.lat, origin.lng);
  } else if (haversineMeters(lastLoc, origin) > NEW_LOCATION_THRESHOLD_METERS) {
    // Clear the old area's cached stores + routes, but KEEP visit history
    // (visited stores and their visits are retained).
    resetForNewLocation();
    try {
      await discoverStores();
      justDiscovered = true;
    } catch {
      /* Google unreachable — proceed with an empty pool, prompt to retry */
    }
    setLastDiscoveryLocation(origin.lat, origin.lng);
  }

  // Replay today's saved route unless the user asked to regenerate.
  if (!regenerate) {
    const existing = getRouteForDate(dateStr);
    if (existing) {
      const ids = JSON.parse(existing.store_ids_json) as string[];
      const ordered = ids
        .map((id) => getStore(id))
        .filter((s): s is StoreRow => Boolean(s));
      if (ordered.length > 0) {
        const route = await routeForOrderedStores(ordered, origin, ROUTE_MODE);
        return buildResponse(dateStr, date, route, {
          source: 'cached',
          clusterIndex: 0,
          alternativeCount: 0,
        });
      }
    }
  }

  // Refresh store data if stale (swallow failures: fall back to cache). Skipped
  // when we just rediscovered for a new location.
  if (!justDiscovered) {
    try {
      await ensureFreshStores();
    } catch {
      /* keep going with whatever is cached */
    }
  }

  const openStores = getOpenStoresTonight(date);
  const clusters = selectClusters(openStores, { origin, date });

  if (clusters.length === 0) {
    const reason =
      getActiveStores().length === 0
        ? 'No stores discovered yet — check the API key and try again.'
        : 'No eligible stores open during tonight’s window.';
    return buildResponse(dateStr, date, degradedRoute([], ROUTE_MODE), {
      source: 'empty',
      clusterIndex: 0,
      alternativeCount: 0,
      warning: reason,
    });
  }

  const index = regenerate
    ? Math.min(Math.max(opts.index ?? 1, 0), clusters.length - 1)
    : 0;
  const chosen = clusters[index];

  const route = await optimizeRoute(chosen.stores, origin, ROUTE_MODE);
  saveRoute(dateStr, route.stops.map((s) => s.store.id));

  return buildResponse(dateStr, date, route, {
    source: 'generated',
    clusterIndex: index,
    alternativeCount: clusters.length,
  });
}
