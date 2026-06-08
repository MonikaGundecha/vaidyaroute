import type { Metadata } from 'next';
import { getVisitsWithStore, type VisitWithStore } from '@/lib/db';
import { outcomeMeta } from '@/lib/ui-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'VaidyaRoute – Log Book' };

function toLocal(ts: string): Date {
  // Stored as UTC "YYYY-MM-DD HH:MM:SS".
  return new Date(ts.replace(' ', 'T') + 'Z');
}

function dateKey(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function HistoryPage() {
  const visits = await getVisitsWithStore();

  // Group by local calendar day, preserving newest-first order.
  const groups: { label: string; items: VisitWithStore[] }[] = [];
  for (const v of visits) {
    const label = dateKey(toLocal(v.visited_at));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(v);
    else groups.push({ label, items: [v] });
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-24 pt-2 md:px-8 md:pb-12">
      <h1 className="mb-6 text-[32px] font-extrabold leading-tight text-ink">
        Log Book
      </h1>

      {visits.length === 0 && (
        <div className="rounded-2xl border border-edge bg-white p-10 text-center shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
          <p className="text-3xl">📋</p>
          <p className="mt-3 text-[18px] font-semibold text-ink">
            No visits logged yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[14px] text-ink-soft">
            Log outcomes from today&apos;s route and they&apos;ll show up here.
          </p>
        </div>
      )}

      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {group.label}
            </h2>
            <div className="space-y-3">
              {group.items.map((v) => {
                const meta = outcomeMeta(v.outcome);
                return (
                  <div
                    key={v.id}
                    className="rounded-2xl border border-edge border-l-[3px] border-l-brand bg-white px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold text-ink">
                          {v.store_name}
                        </p>
                        {v.store_address && (
                          <p className="truncate text-[13px] text-ink-muted">
                            {v.store_address}
                          </p>
                        )}
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${meta.badge}`}
                      >
                        {meta.icon} {meta.label}
                      </span>
                    </div>

                    {v.notes && (
                      <p className="mt-2 text-[14px] text-ink-soft">{v.notes}</p>
                    )}

                    <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-muted">
                      <span>
                        {toLocal(v.visited_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                      {v.next_visit_date && (
                        <span className="text-warning">
                          ↩ Follow up {v.next_visit_date}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
