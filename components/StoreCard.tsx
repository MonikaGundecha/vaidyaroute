'use client';

import Link from 'next/link';
import type { RouteStopResponse } from '@/lib/types';
import { categoryMeta, outcomeMeta, relativeDay } from '@/lib/ui-meta';

interface StoreCardProps {
  stop: RouteStopResponse;
  /** True while this card animates out after skip / mark-irrelevant. */
  exiting?: boolean;
  /** True once a visit has been logged this session — dims the card and locks the button. */
  visited?: boolean;
  onLogVisit: () => void;
  onSkip: () => void;
  onMarkIrrelevant: () => void;
}

export default function StoreCard({
  stop,
  exiting = false,
  visited = false,
  onLogVisit,
  onSkip,
  onMarkIrrelevant,
}: StoreCardProps) {
  const { store } = stop;
  const cat = categoryMeta(store.category);
  const lastOutcome = stop.outcome_history[0]?.outcome ?? null;
  const lastWhen = relativeDay(stop.last_visit);

  const city = store.address.split(',')[1]?.trim() ?? '';
  const researchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    [store.name, city].filter(Boolean).join(' '),
  )}`;

  const outlineBtn =
    'flex h-[36px] items-center justify-center gap-1.5 rounded-full border-[1.5px] border-brand bg-white text-[12px] font-semibold text-brand transition-all duration-200 hover:bg-brand-light active:scale-[0.97]';

  return (
    <div
      className={`rounded-[20px] border border-edge border-l-[3px] border-l-brand bg-white px-5 py-[18px] shadow-[0_1px_4px_rgba(0,0,0,0.07)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] motion-safe:animate-[cardin_0.25s_ease-out] ${
        exiting ? '-translate-y-1 scale-95 opacity-0' : visited ? 'opacity-75' : ''
      }`}
    >
      {/* Top row: number + name + category tag */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand text-[15px] font-semibold text-white">
            {stop.order}
          </span>
          <h3 className="truncate text-[16px] font-bold leading-snug text-ink">
            {store.name}
          </h3>
        </div>
        <span
          className={`mt-0.5 flex-shrink-0 rounded-md px-2.5 py-[3px] text-[11px] font-medium uppercase tracking-[0.05em] ${cat.badge}`}
        >
          {cat.label}
        </span>
      </div>

      {/* Row 2: address */}
      <p className="mt-1.5 text-[13px] text-ink-soft">{store.address}</p>

      {/* Row 2b: rating / open until / travel */}
      <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px]">
        {store.rating != null && (
          <span className="font-medium text-ink-soft">
            <span className="text-amber-500">★</span> {store.rating.toFixed(1)}
          </span>
        )}
        {stop.open_until && (
          <span className="font-medium text-success">
            Open until {stop.open_until}
          </span>
        )}
        <span className="rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-ink-soft">
          → {stop.travel_from_previous}
          {stop.estimated && ' (est.)'}
        </span>
        {visited && (
          <span className="rounded px-1.5 py-0.5 text-[12px] font-semibold bg-success/10 text-success">
            Visited ✓
          </span>
        )}
        {lastWhen && lastOutcome && (
          <span
            className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${outcomeMeta(lastOutcome).badge}`}
          >
            {outcomeMeta(lastOutcome).label} · {lastWhen}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="my-3 h-px bg-edge" />

      {/* Primary actions: 3 outlined on top, Log visit full-width below */}
      <div className="grid grid-cols-3 gap-2">
        <a href={stop.maps_url} target="_blank" rel="noreferrer" className={outlineBtn}>
          📍 Directions
        </a>
        <a
          href={store.phone ? `tel:${store.phone}` : undefined}
          aria-disabled={!store.phone}
          onClick={(e) => {
            if (!store.phone) e.preventDefault();
          }}
          className={
            store.phone
              ? outlineBtn
              : 'flex h-[36px] cursor-not-allowed items-center justify-center gap-1.5 rounded-full border-[1.5px] border-edge bg-white text-[12px] font-semibold text-ink-muted'
          }
        >
          📞 Call
        </a>
        <a href={researchUrl} target="_blank" rel="noreferrer" className={outlineBtn}>
          🌐 Online
        </a>
      </div>
      {visited ? (
        <button
          disabled
          className="mt-2 flex h-[36px] w-full cursor-default items-center justify-center gap-1.5 rounded-full border-[1.5px] border-success bg-white text-[12px] font-semibold text-success"
        >
          Visited ✓
        </button>
      ) : (
        <button
          onClick={onLogVisit}
          className="mt-2 flex h-[36px] w-full items-center justify-center gap-1.5 rounded-full bg-accent text-[12px] font-semibold text-white transition-all duration-200 hover:bg-accent-dark active:scale-[0.97]"
        >
          ✓ Log visit
        </button>
      )}

      {/* Secondary text links */}
      <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-ink-muted">
        <button onClick={onSkip} className="transition-colors hover:text-ink-soft">
          × Skip for today
        </button>
        <span aria-hidden>·</span>
        <button
          onClick={() => {
            if (
              window.confirm(
                'Are you sure? This store will never appear again.',
              )
            ) {
              onMarkIrrelevant();
            }
          }}
          className="transition-colors hover:text-ink-soft"
        >
          ⊘ Mark as irrelevant
        </button>
        <span aria-hidden>·</span>
        <Link
          href={`/stores/${store.id}?from=route`}
          className="transition-colors hover:text-ink-soft"
        >
          → Details
        </Link>
      </div>
    </div>
  );
}
