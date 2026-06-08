// Pure types shared between server and client. No runtime imports here so this
// is safe to import from client components (better-sqlite3 never gets bundled).

export type StoreCategory =
  | 'yoga_studio'
  | 'health_food'
  | 'wellness'
  | 'spa'
  | 'gym'
  | 'indian_grocery'
  | 'indian_restaurant'
  | 'other';

export type VisitOutcome =
  | 'interested'
  | 'not_interested'
  | 'follow_up'
  | 'no_answer'
  | 'closed';

export type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit';

// --- /api/generate-route response -----------------------------------------

export interface RouteStopResponse {
  order: number;
  store: {
    id: string;
    name: string;
    address: string;
    phone: string | null;
    category: StoreCategory | null;
    rating: number | null;
    lat: number;
    lng: number;
  };
  travel_from_previous: string; // e.g. "8 min drive"
  travel_seconds: number;
  estimated: boolean;
  maps_url: string;
  open_until: string | null; // e.g. "8:00 PM" or "24 hours"
  last_visit: string | null;
  outcome_history: {
    outcome: string; // preset VisitOutcome value or a custom string
    visited_at: string;
    notes: string | null;
    next_visit_date: string | null;
  }[];
}

export interface RouteResponse {
  date: string;
  mode: TravelMode;
  origin_address: string;
  stops: RouteStopResponse[];
  total_estimated_time: string;
  used_fallback: boolean;
  cluster_index: number;
  alternative_cluster_count: number;
  google_maps_directions_url: string;
  source: 'generated' | 'cached' | 'fallback' | 'empty' | 'needs_setup';
  warning?: string;
  /** True when no starting address is configured yet (prompt the user). */
  needs_setup?: boolean;
}

// --- /api/follow-ups response ----------------------------------------------

export interface FollowUp {
  store_id: string;
  store_name: string;
  notes: string | null;
  next_visit_date: string;
}

// --- /api/stores response --------------------------------------------------

export interface StoreListItem {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  category: StoreCategory | null;
  google_rating: number | null;
  hours_json: string | null;
  relevance_score: number | null; // 0-10 ayurvedic-prospect relevance
  discovered_at: string;
  refreshed_at: string;
  force_include: number; // 0 | 1
  is_irrelevant: number; // 0 | 1
  skipped_until: string | null; // YYYY-MM-DD this store is suppressed until
  last_outcome: string | null; // preset VisitOutcome value or a custom string
  last_visited_at: string | null;
  next_visit_date: string | null;
}
