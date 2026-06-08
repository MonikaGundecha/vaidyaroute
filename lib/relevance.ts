// Store relevance scoring (0–10) for an ayurvedic-product salesperson.
// Pure module — no DB/runtime imports — so it can be used during DB migration
// (backfill) and in the Places discovery layer alike.

import type { StoreCategory } from './types';

/** Minimum score for a store to be stored/shown/routed. */
export const MIN_RELEVANCE_SCORE = 7;

// Google place types that immediately disqualify a store (score 0). Note: we
// deliberately exclude the generic "food" type here — grocery stores can carry
// it — and rely on "restaurant"/"cafe"/etc. to catch food service.
const ZERO_TYPES = new Set<string>([
  'restaurant', 'bar', 'night_club', 'cafe', 'bakery', 'meal_delivery',
  'meal_takeaway', 'lodging', 'hotel', 'hospital', 'doctor', 'dentist',
  'bank', 'atm', 'finance', 'real_estate_agency', 'parking', 'transit_station',
  'subway_station', 'bus_station', 'train_station', 'gas_station', 'airport',
  'school', 'primary_school', 'secondary_school', 'university', 'car_dealer',
  'car_repair', 'car_wash', 'courthouse', 'embassy', 'funeral_home',
  'cemetery', 'place_of_worship',
]);

/**
 * Relevance score 0–10 from a store's Google place types, name, and the
 * search-derived category. Higher = more likely to stock/sell ayurvedic goods.
 */
export function scoreRelevance(
  name: string,
  types: string[] | undefined,
  category: StoreCategory | null,
): number {
  const n = name.toLowerCase();
  const typeList = types ?? [];
  const t = new Set(typeList);
  const nameHas = (...words: string[]) => words.some((w) => n.includes(w));

  // Ayurvedic anything is the strongest possible signal.
  if (n.includes('ayurved')) return 10;

  // Hard disqualifiers (food service, lodging, transit, finance, …).
  if (typeList.some((type) => ZERO_TYPES.has(type))) return 0;

  // Unambiguous Google types win when present.
  if (t.has('yoga_studio')) return 9;

  switch (category) {
    case 'health_food':
      // herbal / natural / health-food = 10; vitamins / supplements = 8.
      return nameHas('vitamin', 'supplement') ? 8 : 10;
    case 'wellness':
      return nameHas('naturopath', 'acupunctur', 'integrative') ? 8 : 9;
    case 'yoga_studio':
      return nameHas('pilates') ? 7 : 9;
    case 'indian_grocery':
      return 7;
    case 'spa':
      return nameHas('wellness', 'holistic', 'ayurved') ? 5 : 0;
    case 'gym':
      return nameHas('wellness', 'holistic') ? 7 : 0;
    case 'indian_restaurant':
      return 0;
    default:
      // No useful category — fall back to name signals.
      if (nameHas('health food', 'herbal', 'natural grocer', 'organic')) return 10;
      if (nameHas('yoga', 'meditation', 'wellness', 'holistic')) return 9;
      if (nameHas('naturopath', 'acupunctur', 'integrative')) return 8;
      if (nameHas('vitamin', 'supplement')) return 8;
      if (nameHas('pilates')) return 7;
      if (nameHas('indian grocer', 'south asian', 'desi', 'spice')) return 7;
      return 0;
  }
}
