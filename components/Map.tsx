'use client';

import type { RouteStopResponse } from '@/lib/types';

interface MapProps {
  originAddress: string;
  stops: RouteStopResponse[];
  mode?: string;
  /** Maps Embed API key. When present, uses the directions embed (auto-fits). */
  apiKey?: string;
  /** Applied to the iframe so the parent controls sizing. */
  className?: string;
}

/**
 * Embedded route map. With a key it uses the Maps Embed API *directions* view,
 * which auto-frames the whole route (origin → all stops). Without a key it
 * falls back to the classic keyless `output=embed` directions URL.
 */
export default function Map({
  originAddress,
  stops,
  mode = 'driving',
  apiKey,
  className = '',
}: MapProps) {
  if (stops.length === 0) return null;

  const coords = stops.map((s) => `${s.store.lat},${s.store.lng}`);
  let src: string;

  if (apiKey) {
    const origin = encodeURIComponent(originAddress);
    const destination = encodeURIComponent(coords[coords.length - 1]);
    const waypoints = coords.slice(0, -1).join('|');
    const params = [
      `key=${apiKey}`,
      `origin=${origin}`,
      `destination=${destination}`,
      waypoints ? `waypoints=${encodeURIComponent(waypoints)}` : '',
      `mode=${mode}`,
      'zoom=13',
    ]
      .filter(Boolean)
      .join('&');
    src = `https://www.google.com/maps/embed/v1/directions?${params}`;
  } else {
    const saddr = encodeURIComponent(originAddress);
    const daddr = coords.join('+to:');
    const dirflg = mode === 'driving' ? 'd' : mode === 'walking' ? 'w' : 'r';
    src = `https://maps.google.com/maps?saddr=${saddr}&daddr=${daddr}&dirflg=${dirflg}&output=embed`;
  }

  return (
    <iframe
      title="Today's route"
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className={`block w-full border-0 ${className}`}
    />
  );
}
