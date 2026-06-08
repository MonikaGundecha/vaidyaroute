'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RouteResponse, FollowUp } from '@/lib/types';
import StoreCard from '@/components/StoreCard';
import VisitLogger from '@/components/VisitLogger';
import SettingsBar, { EDIT_LOCATION_EVENT } from '@/components/SettingsBar';
import MapPanel from '@/components/MapPanel';
import Map from '@/components/Map';
import { FIND_NEW_STORES_EVENT } from '@/components/Header';

function prettyDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function HomePage() {
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [exitingId, setExitingId] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [mapsKey, setMapsKey] = useState('');
  const routeRef = useRef<RouteResponse | null>(null);
  routeRef.current = route;

  useEffect(() => {
    fetch('/api/maps-key', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => d.key && setMapsKey(d.key))
      .catch(() => {});
  }, []);

  const refreshFollowUps = useCallback(async () => {
    try {
      const res = await fetch('/api/follow-ups', { cache: 'no-store' });
      if (res.ok) setFollowUps((await res.json()).follow_ups ?? []);
    } catch {
      /* non-critical */
    }
  }, []);

  const load = useCallback(
    async (regenerate = false, index = 0) => {
      setLoading(true);
      setError(null);
      try {
        const params = regenerate ? `?regenerate=true&index=${index}` : '';
        const res = await fetch(`/api/generate-route${params}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to load route');
        }
        setRoute(await res.json());
        refreshFollowUps();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load route');
      } finally {
        setLoading(false);
      }
    },
    [refreshFollowUps],
  );

  useEffect(() => {
    load();
  }, [load]);

  // "Regenerate Plan" (header) cycles to the next-best cluster.
  useEffect(() => {
    const handler = () => {
      const r = routeRef.current;
      const count = Math.max(r?.alternative_cluster_count ?? 1, 1);
      const next = r ? (r.cluster_index + 1) % count : 0;
      load(true, next);
    };
    window.addEventListener(FIND_NEW_STORES_EVENT, handler);
    return () => window.removeEventListener(FIND_NEW_STORES_EVENT, handler);
  }, [load]);

  // Animate a stop out, run a mutation, then regenerate so a replacement loads.
  const removeAndRegen = useCallback(
    (storeId: string, run: () => Promise<unknown>) => {
      setExitingId(storeId);
      window.setTimeout(async () => {
        try {
          await run();
          await load(true, 0);
        } catch {
          /* leave current route in place on failure */
        } finally {
          setExitingId(null);
        }
      }, 220);
    },
    [load],
  );

  const skipStop = useCallback(
    (storeId: string) =>
      removeAndRegen(storeId, () =>
        fetch('/api/skip-store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: storeId }),
        }),
      ),
    [removeAndRegen],
  );

  const markIrrelevant = useCallback(
    (storeId: string) =>
      removeAndRegen(storeId, () =>
        fetch('/api/stores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: storeId, is_irrelevant: true }),
        }),
      ),
    [removeAndRegen],
  );

  const needsSetup = route?.needs_setup;
  const hasStops = !!route && !needsSetup && route.stops.length > 0;
  const noStores = !!route && !needsSetup && !loading && route.stops.length === 0;
  const summary = hasStops
    ? `${route!.stops.length} ${route!.stops.length === 1 ? 'stop' : 'stops'} · ${route!.total_estimated_time} drive`
    : null;

  return (
    <main className="md:flex md:h-screen md:overflow-hidden">
      {/* LEFT — route list, scrolls independently of the map */}
      <div className="w-full px-4 pb-24 pt-4 md:h-screen md:w-[45%] md:overflow-y-auto md:pb-6 md:pl-6 md:pr-4 md:pt-6">
        <header className="mb-4">
          <h1 className="text-[26px] font-extrabold leading-tight text-ink">
            Today&apos;s Plan
          </h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            {prettyDate()}
            {summary ? ` · ${summary}` : ''}
          </p>
        </header>

        <SettingsBar onSaved={() => load(true, 0)} />

        {followUps.length > 0 && (
          <div className="mb-5 space-y-2">
            {followUps.map((f) => (
              <Link
                key={f.store_id}
                href={`/stores/${f.store_id}?from=route`}
                className="block rounded-[10px] border-l-[3px] border-warning bg-accent-soft px-4 py-3 transition-colors hover:brightness-[0.98]"
              >
                <div className="flex items-center gap-2 text-[14px] font-semibold text-accent-text">
                  <span aria-hidden className="text-[18px] leading-none">
                    📅
                  </span>
                  Follow-up today: {f.store_name}
                </div>
                {f.notes && (
                  <p className="mt-0.5 pl-7 text-[13px] text-[#B45309]">
                    {f.notes}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}

        {route &&
          route.alternative_cluster_count > 1 &&
          hasStops && (
            <p className="mb-3 text-[12px] text-ink-muted">
              Showing option {route.cluster_index + 1} of{' '}
              {route.alternative_cluster_count}
            </p>
          )}

        {/* Mobile map (desktop uses the sticky panel instead) */}
        {hasStops && (
          <div className="mb-5 space-y-3 md:hidden">
            <div className="overflow-hidden rounded-2xl border border-edge shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
              <Map
                originAddress={route!.origin_address}
                stops={route!.stops}
                mode={route!.mode}
                apiKey={mapsKey}
                className="h-[220px]"
              />
            </div>
            <a
              href={route!.google_maps_directions_url}
              target="_blank"
              rel="noreferrer"
              className="flex h-[52px] items-center justify-center rounded-xl bg-brand text-[15px] font-semibold text-white transition-all duration-200 active:scale-[0.99]"
            >
              Open full route in Google Maps
            </a>
          </div>
        )}

        {loading && !route && <RouteSkeleton />}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-danger">
            {error}
            <button
              onClick={() => load()}
              className="ml-2 font-semibold underline"
            >
              Retry
            </button>
          </div>
        )}

        {needsSetup && !loading && (
          <div className="rounded-2xl border border-brand/20 bg-brand-light p-8 text-center">
            <PinOutline />
            <p className="mt-3 text-[18px] font-semibold text-ink">
              Set your starting address
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[14px] text-ink-soft">
              Routes start from a fixed address. Add yours above to plan
              today&apos;s route.
            </p>
          </div>
        )}

        {noStores && <EmptyState />}

        {hasStops && (
          <div
            className={`space-y-3 ${loading ? 'opacity-50 transition-opacity' : ''}`}
          >
            {route!.stops.map((stop) => (
              <StoreCard
                key={stop.store.id}
                stop={stop}
                exiting={exitingId === stop.store.id}
                onLogVisit={() => setLogging({ id: stop.store.id, name: stop.store.name })}
                onSkip={() => skipStop(stop.store.id)}
                onMarkIrrelevant={() => markIrrelevant(stop.store.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* RIGHT — sticky map panel (desktop only) */}
      {route && !needsSetup && <MapPanel route={route} apiKey={mapsKey} />}

      {logging && (
        <VisitLogger
          storeId={logging.id}
          storeName={logging.name}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            load();
          }}
        />
      )}
    </main>
  );
}

// --- helpers ---------------------------------------------------------------

function PinOutline({ size = 48 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="mx-auto"
      aria-hidden
    >
      <path
        d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6z"
        fill="none"
        stroke="#1D6B4A"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="8" r="2.2" fill="none" stroke="#1D6B4A" strokeWidth="1.8" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-edge bg-white p-10 text-center shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
      <PinOutline size={64} />
      <p className="mt-4 text-[18px] font-semibold text-ink">
        No stores found nearby
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-ink-soft">
        Try adjusting your location or selling hours.
      </p>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent(EDIT_LOCATION_EVENT))}
        className="mt-5 rounded-full bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-brand-dark active:scale-[0.97]"
      >
        Update location
      </button>
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-edge border-l-[3px] border-l-brand/30 bg-white px-5 py-[18px] shadow-[0_1px_4px_rgba(0,0,0,0.07)]"
        >
          <div className="flex gap-4">
            <div className="shimmer h-[42px] w-[42px] flex-shrink-0 rounded-full" />
            <div className="flex-1 space-y-2.5">
              <div className="shimmer h-4 w-2/3 rounded" />
              <div className="shimmer h-3 w-full rounded" />
              <div className="shimmer h-3 w-1/2 rounded" />
            </div>
          </div>
          <div className="my-[14px] h-px bg-edge" />
          <div className="grid grid-cols-3 gap-2">
            <div className="shimmer h-11 rounded-[10px]" />
            <div className="shimmer h-11 rounded-[10px]" />
            <div className="shimmer h-11 rounded-[10px]" />
          </div>
        </div>
      ))}
    </div>
  );
}
