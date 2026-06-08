import {
  getLatestVisitsByStore,
  getRecentlyVisitedStoreIds,
  getForceIncludedStoreIds,
  getSkippedStoreIds,
  type StoreRow,
} from './db';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Cluster {
  stores: StoreRow[];
  centroid: LatLng;
  distanceFromOriginMeters: number;
  hasDueFollowUp: boolean;
  hasForced: boolean;
}

export interface SelectClustersOptions {
  origin: LatLng;
  date?: Date;
  /** Target maximum stores per cluster (brief says 3–4). */
  maxClusterSize?: number;
  /** Preferred minimum; clusters below this are ranked lower. */
  minClusterSize?: number;
  /** How many days a visited store is suppressed before it can reappear. */
  visitCooldownDays?: number;
  /** Max distance (m) to the nearest cluster member when growing a cluster. */
  maxIntraClusterMeters?: number;
}

const DEFAULTS = {
  maxClusterSize: 4,
  minClusterSize: 3,
  visitCooldownDays: 30,
  maxIntraClusterMeters: 6000,
};

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function centroidOf(stores: StoreRow[]): LatLng {
  const n = stores.length || 1;
  const sum = stores.reduce(
    (acc, s) => ({ lat: acc.lat + s.lat, lng: acc.lng + s.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / n, lng: sum.lng / n };
}

/** Local-time YYYY-MM-DD for the given date (defaults to now). */
export function todayString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-time YYYY-MM-DD for the day after the given date (defaults to now). */
export function tomorrowString(date: Date = new Date()): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return todayString(next);
}

// ---------------------------------------------------------------------------
// Candidate selection (visit-based exclusions + follow-up prioritization)
// ---------------------------------------------------------------------------

interface Candidates {
  stores: StoreRow[];
  dueFollowUpIds: Set<string>;
  forcedIds: Set<string>;
}

/**
 * From the stores open tonight, drop ones we shouldn't visit and flag the
 * follow-ups that are due:
 *   - permanently exclude stores whose latest outcome is `not_interested`
 *   - suppress stores visited within the cooldown window…
 *   - …unless they're a follow-up whose `next_visit_date` has arrived, which
 *     overrides the cooldown so they resurface.
 * Stores the user pinned ("force include") bypass every exclusion above.
 */
function selectCandidates(
  openStores: StoreRow[],
  date: Date,
  cooldownDays: number,
): Candidates {
  const latest = getLatestVisitsByStore();
  const recent = new Set(getRecentlyVisitedStoreIds(cooldownDays));
  const forcedIds = new Set(getForceIncludedStoreIds());
  const today = todayString(date);
  const skippedIds = new Set(getSkippedStoreIds(today));

  const dueFollowUpIds = new Set<string>();
  for (const [storeId, visit] of Array.from(latest.entries())) {
    if (
      visit.outcome === 'follow_up' &&
      visit.next_visit_date &&
      visit.next_visit_date <= today
    ) {
      dueFollowUpIds.add(storeId);
    }
  }

  const stores = openStores.filter((s) => {
    if (forcedIds.has(s.id)) return true; // pinned: always a candidate
    const lv = latest.get(s.id);
    if (lv?.outcome === 'not_interested') return false; // permanent
    if (skippedIds.has(s.id)) return false; // "skip today" until skipped_until
    if (recent.has(s.id) && !dueFollowUpIds.has(s.id)) return false; // cooldown
    return true;
  });

  return { stores, dueFollowUpIds, forcedIds };
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

/**
 * Greedy geographic clustering. Seed each cluster with the unassigned store
 * closest to the origin, then grow it by repeatedly attaching the nearest
 * remaining store to any current member — stopping at maxClusterSize or when
 * the nearest remaining store is farther than maxIntraClusterMeters (which
 * starts a fresh cluster instead of stretching this one).
 */
export function clusterStores(
  stores: StoreRow[],
  origin: LatLng,
  opts: { maxClusterSize: number; maxIntraClusterMeters: number },
): StoreRow[][] {
  const remaining = [...stores];
  const clusters: StoreRow[][] = [];

  const distToOrigin = (s: StoreRow) => haversineMeters(origin, { lat: s.lat, lng: s.lng });

  while (remaining.length > 0) {
    // Seed with the remaining store nearest the origin.
    let seedIdx = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (distToOrigin(remaining[i]) < distToOrigin(remaining[seedIdx])) seedIdx = i;
    }
    const cluster: StoreRow[] = [remaining.splice(seedIdx, 1)[0]];

    while (cluster.length < opts.maxClusterSize && remaining.length > 0) {
      // Find the remaining store nearest to any current cluster member.
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const cand = { lat: remaining[i].lat, lng: remaining[i].lng };
        let nearest = Infinity;
        for (const member of cluster) {
          const d = haversineMeters({ lat: member.lat, lng: member.lng }, cand);
          if (d < nearest) nearest = d;
        }
        if (nearest < bestDist) {
          bestDist = nearest;
          bestIdx = i;
        }
      }
      if (bestIdx === -1 || bestDist > opts.maxIntraClusterMeters) break;
      cluster.push(remaining.splice(bestIdx, 1)[0]);
    }

    clusters.push(cluster);
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Selection + ranking
// ---------------------------------------------------------------------------

/**
 * End-to-end cluster selection for an evening: apply visit-based exclusions to
 * the stores open tonight, cluster the survivors geographically, and return the
 * clusters ranked best-first. The route generator takes index 0 normally and a
 * higher index when the user hits "Regenerate".
 */
export function selectClusters(
  openStores: StoreRow[],
  options: SelectClustersOptions,
): Cluster[] {
  const cfg = { ...DEFAULTS, ...options };
  const date = options.date ?? new Date();

  const { stores, dueFollowUpIds, forcedIds } = selectCandidates(
    openStores,
    date,
    cfg.visitCooldownDays,
  );
  if (stores.length === 0) return [];

  const grouped = clusterStores(stores, cfg.origin, {
    maxClusterSize: cfg.maxClusterSize,
    maxIntraClusterMeters: cfg.maxIntraClusterMeters,
  });

  const clusters: Cluster[] = grouped.map((group) => {
    const centroid = centroidOf(group);
    return {
      stores: group,
      centroid,
      distanceFromOriginMeters: haversineMeters(cfg.origin, centroid),
      hasDueFollowUp: group.some((s) => dueFollowUpIds.has(s.id)),
      hasForced: group.some((s) => forcedIds.has(s.id)),
    };
  });

  // Rank: pinned clusters first, then due follow-ups, then well-sized
  // clusters (>= min), then closest to the origin.
  clusters.sort((a, b) => {
    if (a.hasForced !== b.hasForced) return a.hasForced ? -1 : 1;
    if (a.hasDueFollowUp !== b.hasDueFollowUp) return a.hasDueFollowUp ? -1 : 1;
    const aSized = a.stores.length >= cfg.minClusterSize;
    const bSized = b.stores.length >= cfg.minClusterSize;
    if (aSized !== bSized) return aSized ? -1 : 1;
    return a.distanceFromOriginMeters - b.distanceFromOriginMeters;
  });

  return clusters;
}
