import type { StoreCategory, VisitOutcome } from './types';

// Tailwind classes are written as full literal strings so the JIT scanner keeps
// them. Category tags share a single warm-amber treatment for a cohesive
// wellness look; the label distinguishes the category.

interface Meta {
  label: string;
  badge: string; // background + text + border classes
  dot: string; // accent dot/bar color
}

// Warm-amber badge used by every category tag (accent-light bg, amber text).
const AMBER_BADGE = 'bg-accent-light text-accent-text';

const CATEGORY_META: Record<StoreCategory, Meta> = {
  yoga_studio: { label: 'Yoga', badge: AMBER_BADGE, dot: 'bg-brand' },
  health_food: { label: 'Health Food', badge: AMBER_BADGE, dot: 'bg-brand' },
  wellness: { label: 'Wellness', badge: AMBER_BADGE, dot: 'bg-brand' },
  spa: { label: 'Spa', badge: AMBER_BADGE, dot: 'bg-brand' },
  gym: { label: 'Gym', badge: AMBER_BADGE, dot: 'bg-brand' },
  indian_grocery: { label: 'Indian Grocery', badge: AMBER_BADGE, dot: 'bg-brand' },
  indian_restaurant: {
    label: 'Indian Restaurant',
    badge: AMBER_BADGE,
    dot: 'bg-brand',
  },
  other: { label: 'Other', badge: AMBER_BADGE, dot: 'bg-brand' },
};

export function categoryMeta(category: StoreCategory | null): Meta {
  return CATEGORY_META[category ?? 'other'] ?? CATEGORY_META.other;
}

interface OutcomeMeta {
  label: string;
  badge: string;
  icon: string;
}

const OUTCOME_META: Record<VisitOutcome, OutcomeMeta> = {
  interested: { label: 'Interested', badge: 'bg-emerald-100 text-emerald-800', icon: '✓' },
  not_interested: { label: 'Not Interested', badge: 'bg-red-100 text-red-800', icon: '✗' },
  follow_up: { label: 'Follow-up', badge: 'bg-amber-100 text-amber-800', icon: '📅' },
  no_answer: { label: 'No Answer', badge: 'bg-gray-100 text-gray-700', icon: '…' },
  closed: { label: 'Closed', badge: 'bg-gray-100 text-gray-700', icon: '🔒' },
};

/**
 * Display metadata for an outcome. Accepts any string: preset outcomes get
 * their fixed label/colour, custom outcomes render their own text with a
 * violet "custom" badge.
 */
export function outcomeMeta(outcome: string): OutcomeMeta {
  return (
    OUTCOME_META[outcome as VisitOutcome] ?? {
      label: outcome,
      badge: 'bg-violet-100 text-violet-900',
      icon: '•',
    }
  );
}

export const ALL_OUTCOMES: VisitOutcome[] = [
  'interested',
  'not_interested',
  'follow_up',
  'no_answer',
  'closed',
];

/** "3 days ago", "Today", "Yesterday" from an ISO-ish timestamp. */
export function relativeDay(timestamp: string | null): string | null {
  if (!timestamp) return null;
  // Stored as UTC "YYYY-MM-DD HH:MM:SS"; normalize to a parseable form.
  const t = new Date(timestamp.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
