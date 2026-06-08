import { requireMapsApiKey, PlacesError } from './places';
import { haversineMeters, type LatLng } from './clustering';
import type { StoreRow } from './db';

const DISTANCE_MATRIX_URL =
  'https://maps.googleapis.com/maps/api/distancematrix/json';

// Average driving speed (m/s) used to estimate durations when the Distance
// Matrix API is unavailable. ~11 m/s ≈ 40 km/h (urban driving).
const DRIVE_SPEED_MPS = 11;

export type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit';

export interface TravelLeg {
  /** Seconds to travel from the previous stop (origin for the first stop). */
  seconds: number;
  /** Human label, e.g. "8 min". */
  text: string;
  /** True if this leg was estimated locally because the API didn't cover it. */
  estimated: boolean;
}

export interface RouteStop {
  order: number; // 1-based
  store: StoreRow;
  travelFromPrevious: TravelLeg;
}

export interface OptimizedRoute {
  origin: LatLng;
  mode: TravelMode;
  stops: RouteStop[];
  totalTravelSeconds: number;
  totalTravelText: string;
  /** True if any leg fell back to a local estimate. */
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// ---------------------------------------------------------------------------
// Distance Matrix
// ---------------------------------------------------------------------------

interface DistanceMatrixResponse {
  status: string;
  error_message?: string;
  rows?: {
    elements: {
      status: string;
      duration?: { value: number; text: string };
    }[];
  }[];
}

function pointParam(p: LatLng): string {
  return `${p.lat},${p.lng}`;
}

/**
 * Full NxN duration matrix (seconds) for the given points via Distance Matrix.
 * Element value is null when the API can't route that pair. Throws on a
 * transport/quota failure so the caller can fall back to local estimates.
 */
async function fetchDurationMatrix(
  points: LatLng[],
  mode: TravelMode,
): Promise<(number | null)[][]> {
  const coords = points.map(pointParam).join('|');
  const url = new URL(DISTANCE_MATRIX_URL);
  url.searchParams.set('origins', coords);
  url.searchParams.set('destinations', coords);
  url.searchParams.set('mode', mode);
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', requireMapsApiKey());

  let json: DistanceMatrixResponse;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    json = await res.json();
  } catch (err) {
    throw new PlacesError('Distance Matrix request failed', err);
  }

  if (json.status !== 'OK' || !json.rows) {
    throw new PlacesError(
      `Distance Matrix error: ${json.status}${
        json.error_message ? ` — ${json.error_message}` : ''
      }`,
    );
  }

  return json.rows.map((row) =>
    row.elements.map((el) =>
      el.status === 'OK' && el.duration ? el.duration.value : null,
    ),
  );
}

/** Local straight-line driving-time estimate (seconds) between two points. */
function estimateSeconds(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b) / DRIVE_SPEED_MPS;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor TSP
// ---------------------------------------------------------------------------

/**
 * Order the stores into a route that starts at the origin, repeatedly hopping
 * to the nearest unvisited store. Index 0 of the matrix is the origin; indices
 * 1..n correspond to `stores[0..n-1]`.
 */
function nearestNeighborOrder(
  matrix: (number | null)[][],
  storeCount: number,
  fallback: (i: number, j: number) => number,
): number[] {
  const cost = (i: number, j: number) => matrix[i]?.[j] ?? fallback(i, j);

  const visited = new Array(storeCount + 1).fill(false);
  visited[0] = true; // origin
  const order: number[] = [];
  let current = 0;

  for (let step = 0; step < storeCount; step++) {
    let best = -1;
    let bestCost = Infinity;
    for (let j = 1; j <= storeCount; j++) {
      if (visited[j]) continue;
      const c = cost(current, j);
      if (c < bestCost) {
        bestCost = c;
        best = j;
      }
    }
    visited[best] = true;
    order.push(best);
    current = best;
  }

  return order; // matrix indices (1-based into stores)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const emptyRoute = (origin: LatLng, mode: TravelMode): OptimizedRoute => ({
  origin,
  mode,
  stops: [],
  totalTravelSeconds: 0,
  totalTravelText: formatDuration(0),
  usedFallback: false,
});

/**
 * Fetch the duration matrix for [origin, ...stores] and assemble a route that
 * follows the given matrix-index order (1-based into `stores`). Any leg the API
 * doesn't cover — or a total API failure — falls back to a local estimate.
 */
async function assembleRoute(
  stores: StoreRow[],
  origin: LatLng,
  mode: TravelMode,
  chooseOrder: (matrix: (number | null)[][] | null, fallback: (i: number, j: number) => number) => number[],
): Promise<OptimizedRoute> {
  if (stores.length === 0) return emptyRoute(origin, mode);

  const points: LatLng[] = [origin, ...stores.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const fallback = (i: number, j: number) => estimateSeconds(points[i], points[j]);

  let matrix: (number | null)[][] | null = null;
  try {
    matrix = await fetchDurationMatrix(points, mode);
  } catch {
    matrix = null; // total failure -> estimate everything
  }

  const order = chooseOrder(matrix, fallback);

  let usedFallback = matrix === null;
  let totalTravelSeconds = 0;
  let prev = 0; // origin index

  const stops: RouteStop[] = order.map((matrixIdx, position) => {
    const apiValue = matrix?.[prev]?.[matrixIdx] ?? null;
    const estimated = apiValue === null;
    const seconds = estimated ? fallback(prev, matrixIdx) : apiValue;
    if (estimated) usedFallback = true;
    totalTravelSeconds += seconds;
    prev = matrixIdx;

    return {
      order: position + 1,
      store: stores[matrixIdx - 1],
      travelFromPrevious: { seconds, text: formatDuration(seconds), estimated },
    };
  });

  return {
    origin,
    mode,
    stops,
    totalTravelSeconds,
    totalTravelText: formatDuration(totalTravelSeconds),
    usedFallback,
  };
}

/**
 * Build an optimized route for a cluster of stores using nearest-neighbor TSP
 * from the origin. Resilient to Distance Matrix outages (see assembleRoute).
 */
export async function optimizeRoute(
  stores: StoreRow[],
  origin: LatLng,
  mode: TravelMode = 'driving',
): Promise<OptimizedRoute> {
  return assembleRoute(stores, origin, mode, (matrix, fallback) =>
    nearestNeighborOrder(matrix ?? [], stores.length, fallback),
  );
}

/**
 * Build a route that visits stores in the exact order given (no re-optimizing),
 * just computing the travel legs. Used to replay a route already saved for the
 * day so the stop order stays stable across page loads.
 */
export async function routeForOrderedStores(
  orderedStores: StoreRow[],
  origin: LatLng,
  mode: TravelMode = 'driving',
): Promise<OptimizedRoute> {
  // Matrix index i+1 corresponds to orderedStores[i]; keep that sequence.
  const fixedOrder = orderedStores.map((_, i) => i + 1);
  return assembleRoute(orderedStores, origin, mode, () => fixedOrder);
}

// ---------------------------------------------------------------------------
// Google Maps directions URL
// ---------------------------------------------------------------------------

/**
 * Multi-stop Google Maps directions URL: START -> STOP1 -> ... so the route
 * opens with one tap. `originAddress` is used for the start waypoint; stops use
 * "lat,lng" which Maps resolves reliably.
 */
export function buildGoogleMapsDirectionsUrl(
  originAddress: string,
  orderedStores: StoreRow[],
  mode: TravelMode = 'driving',
): string {
  const waypoints = [
    encodeURIComponent(originAddress),
    ...orderedStores.map((s) => `${s.lat},${s.lng}`),
  ];
  return `https://www.google.com/maps/dir/${waypoints.join('/')}/?travelmode=${mode}`;
}
