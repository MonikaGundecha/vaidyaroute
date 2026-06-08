'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StoreListItem, StoreCategory } from '@/lib/types';
import { categoryMeta, outcomeMeta, relativeDay } from '@/lib/ui-meta';

const FILTERS: { key: StoreCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'indian_grocery', label: 'Indian Grocery' },
  { key: 'indian_restaurant', label: 'Indian Rest.' },
  { key: 'wellness', label: 'Wellness' },
  { key: 'health_food', label: 'Health Food' },
  { key: 'yoga_studio', label: 'Yoga' },
  { key: 'spa', label: 'Spa' },
  { key: 'gym', label: 'Gym' },
];

export default function StoresPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StoreCategory | 'all'>('all');
  const [showIrrelevant, setShowIrrelevant] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/stores', { cache: 'no-store' });
    const data = await res.json();
    setStores(data.stores ?? []);
    setLoading(false);
  }

  useEffect(() => {
    document.title = 'VaidyaRoute – Stores';
    load();
  }, []);

  const irrelevantCount = useMemo(
    () => stores.filter((s) => s.is_irrelevant).length,
    [stores],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores
      .filter((s) => {
        // Visibility gate: irrelevant stores need the toggle; relevant ones
        // must clear the score threshold (only show >= 7).
        if (s.is_irrelevant) {
          if (!showIrrelevant) return false;
        } else if ((s.relevance_score ?? 7) < 7) {
          return false;
        }
        if (filter !== 'all' && s.category !== filter) return false;
        if (q && !`${s.name} ${s.address}`.toLowerCase().includes(q)) return false;
        return true;
      })
      // Most relevant first (tie-break alphabetically).
      .sort(
        (a, b) =>
          (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
          a.name.localeCompare(b.name),
      );
  }, [stores, query, filter, showIrrelevant]);

  async function togglePin(store: StoreListItem) {
    const next = store.force_include ? false : true;
    setPending(store.id);
    // Optimistic update.
    setStores((prev) =>
      prev.map((s) =>
        s.id === store.id ? { ...s, force_include: next ? 1 : 0 } : s,
      ),
    );
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: store.id, force_include: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure.
      setStores((prev) =>
        prev.map((s) =>
          s.id === store.id ? { ...s, force_include: next ? 0 : 1 } : s,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-24 pt-2 md:px-8 md:pb-12">
      <h1 className="mb-5 text-[32px] font-extrabold leading-tight text-ink">
        Stores
      </h1>

      {/* Search bar with leading icon */}
      <div className="relative mb-4">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or address…"
          className="h-12 w-full rounded-xl border-[1.5px] border-edge pl-11 pr-3 text-[15px] outline-none transition-colors focus:border-brand"
        />
      </div>

      {/* Category filter chips */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-8 md:px-8">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex h-[34px] flex-shrink-0 items-center rounded-full px-4 text-[13px] font-medium transition-colors duration-200 ${
              filter === f.key
                ? 'bg-brand text-white'
                : 'border border-edge bg-white text-ink-soft'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-ink-muted">
          {loading ? 'Loading…' : `${visible.length} of ${stores.length} stores`}
        </p>
        {irrelevantCount > 0 && (
          <button
            onClick={() => setShowIrrelevant((v) => !v)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
              showIrrelevant
                ? 'border-amber-300 bg-accent-soft text-accent-text'
                : 'border-edge bg-white text-ink-muted'
            }`}
          >
            {showIrrelevant ? 'Hide' : 'Show'} hidden ({irrelevantCount})
          </button>
        )}
      </div>

      <div className="space-y-3">
        {visible.map((s) => {
          const cat = categoryMeta(s.category);
          const pinned = !!s.force_include;
          const lastWhen = relativeDay(s.last_visited_at);
          const score = s.relevance_score ?? 0;
          const dot =
            score >= 9 ? 'bg-success' : score >= 7 ? 'bg-accent' : 'bg-ink-muted';
          return (
            <div
              key={s.id}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/stores/${s.id}?from=stores`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') router.push(`/stores/${s.id}?from=stores`);
              }}
              className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${
                s.is_irrelevant ? 'border-amber-200 opacity-70' : 'border-edge'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    className={`mt-[7px] h-2 w-2 flex-shrink-0 rounded-full ${dot}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">
                      {s.name}
                    </p>
                    <p className="truncate text-[13px] text-ink-muted">
                      {s.address}
                    </p>
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 rounded-md px-2.5 py-[3px] text-[11px] font-medium uppercase tracking-[0.05em] ${cat.badge}`}
                >
                  {cat.label}
                </span>
              </div>

              {s.is_irrelevant && (
                <p className="mt-1.5 pl-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-warning">
                  Hidden · excluded from routes
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[13px]">
                {s.google_rating != null && (
                  <span className="font-medium text-ink-soft">
                    <span className="text-amber-500">★</span>{' '}
                    {s.google_rating.toFixed(1)}
                  </span>
                )}
                {s.last_outcome ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${outcomeMeta(s.last_outcome).badge}`}
                  >
                    {outcomeMeta(s.last_outcome).label}
                    {lastWhen ? ` · ${lastWhen}` : ''}
                  </span>
                ) : (
                  <span className="text-ink-muted">Never visited</span>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(s);
                }}
                disabled={pending === s.id}
                className={`mt-3 min-h-[44px] w-full rounded-xl text-[14px] font-semibold transition-all duration-200 active:scale-[0.99] disabled:opacity-60 ${
                  pinned
                    ? 'bg-brand text-white hover:bg-brand-dark'
                    : 'border-[1.5px] border-brand bg-white text-brand hover:bg-brand-light'
                }`}
              >
                {pinned ? '📌 Added to tonight' : 'Add to tonight'}
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
}
