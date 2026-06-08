import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStore, getVisitsForStore } from '@/lib/db';
import { getWeekdayHours } from '@/lib/places';
import { categoryMeta, outcomeMeta, relativeDay } from '@/lib/ui-meta';
import StoreActions from '@/components/StoreActions';
import QuickLogForm from '@/components/QuickLogForm';
import BackLink from '@/components/BackLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const store = getStore(params.id);
  return { title: `VaidyaRoute – ${store?.name ?? 'Store'}` };
}

function toLocal(ts: string): Date {
  return new Date(ts.replace(' ', 'T') + 'Z');
}

export default function StoreDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const store = getStore(params.id);
  if (!store) notFound();

  const cat = categoryMeta(store.category);
  const visits = getVisitsForStore(store.id);
  const weekdayHours = getWeekdayHours(store.hours_json);
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const city = store.address.split(',')[1]?.trim() ?? '';
  const researchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    [store.name, city].filter(Boolean).join(' '),
  )}`;

  const card =
    'rounded-2xl border border-edge bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]';
  const sectionLabel =
    'mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted';

  return (
    <main className="px-4 pb-24 pt-2 md:px-8 md:pb-12">
      <Suspense fallback={<div className="mb-4 h-5" />}>
        <BackLink />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[55fr_45fr]">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* Header card */}
          <div className={`${card} border-l-[3px] border-l-brand`}>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[26px] font-bold leading-tight text-ink">
                {store.name}
              </h1>
              <span
                className={`mt-1 flex-shrink-0 rounded-md px-2.5 py-[3px] text-[11px] font-medium uppercase tracking-[0.05em] ${cat.badge}`}
              >
                {cat.label}
              </span>
            </div>

            <a
              href={researchUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-brand bg-white px-3 py-1.5 text-[12px] font-semibold text-brand transition-all duration-200 hover:bg-brand-light active:scale-[0.97]"
            >
              🌐 Check online
            </a>

            <p className="mt-3 text-[14px] text-ink-soft">{store.address}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
              {store.google_rating != null && (
                <span className="font-medium text-ink-soft">
                  <span className="text-amber-500">★</span>{' '}
                  {store.google_rating.toFixed(1)}
                </span>
              )}
              {store.phone ? (
                <a href={`tel:${store.phone}`} className="font-medium text-brand">
                  📞 {store.phone}
                </a>
              ) : (
                <span className="text-ink-muted">No phone on file</span>
              )}
            </div>
          </div>

          {/* Actions card */}
          <div className={card}>
            <StoreActions
              storeId={store.id}
              forceInclude={store.force_include === 1}
              isIrrelevant={store.is_irrelevant === 1}
              skippedUntil={store.skipped_until}
            />
          </div>

          {/* Opening hours card */}
          <div className={card}>
            <h2 className={sectionLabel}>Opening hours</h2>
            {weekdayHours ? (
              <ul className="overflow-hidden rounded-xl border border-edge text-[14px]">
                {weekdayHours.map((line) => {
                  const [day, ...rest] = line.split(': ');
                  const isToday = day === todayName;
                  return (
                    <li
                      key={line}
                      className={`flex justify-between gap-3 px-3.5 py-2 ${
                        isToday
                          ? 'bg-brand-light font-semibold text-brand'
                          : 'text-ink-soft'
                      }`}
                    >
                      <span className={isToday ? '' : 'font-medium text-ink'}>
                        {day}
                      </span>
                      <span className="text-right">{rest.join(': ')}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-muted">No hours available.</p>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — sticky, scrolls independently of the left */}
        <div className="space-y-4 md:sticky md:top-6 md:max-h-[calc(100vh-120px)] md:overflow-y-auto md:pr-1">

          {/* Visit history card */}
          <div className={card}>
            <h2 className="mb-3 text-[16px] font-semibold text-ink">
              Visit History
            </h2>
            {visits.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-ink-muted">
                No visits logged yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {visits.map((v) => {
                  const meta = outcomeMeta(v.outcome);
                  const when = toLocal(v.visited_at);
                  return (
                    <li key={v.id} className="border-l-2 border-edge pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent-text">
                          {when.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${meta.badge}`}
                        >
                          {meta.icon} {meta.label}
                        </span>
                        <span className="text-[12px] text-ink-muted">
                          {relativeDay(v.visited_at)}
                        </span>
                      </div>
                      {v.notes && (
                        <p className="mt-1 text-[14px] text-ink-soft">{v.notes}</p>
                      )}
                      {v.next_visit_date && (
                        <p className="mt-1 text-[12px] text-warning">
                          ↩ Follow up {v.next_visit_date}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Quick log card */}
          <div className={card}>
            <QuickLogForm storeId={store.id} />
          </div>
        </div>
      </div>
    </main>
  );
}
