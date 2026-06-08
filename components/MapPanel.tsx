'use client';

import type { RouteResponse } from '@/lib/types';
import Map from './Map';

/**
 * Desktop-only floating map panel: rounded, shadowed, with gaps from every
 * screen edge. The "Open full route" button lives inside at the bottom.
 */
export default function MapPanel({
  route,
  apiKey,
}: {
  route: RouteResponse;
  apiKey?: string;
}) {
  const hasStops = route.stops.length > 0;
  return (
    <div className="hidden w-[55%] md:block">
      <div className="mb-5 ml-0 mr-5 mt-6 flex h-[calc(100vh-44px)] flex-col overflow-hidden rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.10)]">
        {hasStops ? (
          <>
            <Map
              originAddress={route.origin_address}
              stops={route.stops}
              mode={route.mode}
              apiKey={apiKey}
              className="min-h-0 flex-1"
            />
            <a
              href={route.google_maps_directions_url}
              target="_blank"
              rel="noreferrer"
              className="m-3 flex h-12 items-center justify-center rounded-xl bg-brand text-[15px] font-semibold text-white transition-all duration-200 hover:bg-brand-dark active:scale-[0.99]"
              style={{ width: 'calc(100% - 24px)' }}
            >
              Open full route in Google Maps
            </a>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-white px-8 text-center text-sm text-ink-muted">
            Your map appears here once a plan is ready.
          </div>
        )}
      </div>
    </div>
  );
}
