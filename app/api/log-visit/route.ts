import { NextResponse, type NextRequest } from 'next/server';
import { insertVisit, getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  console.log('[log-visit] request received');

  // (b) Body parsing
  let body: unknown;
  try {
    body = await req.json();
    console.log('[log-visit] body parsed:', JSON.stringify(body));
  } catch (err) {
    console.error('[log-visit] body parse failed:', err);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { store_id, outcome, notes, next_visit_date } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof store_id !== 'string' || store_id.length === 0) {
    console.warn('[log-visit] rejected: missing store_id');
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  }
  // (d) Outcome is free-form text now (the DB no longer has a CHECK constraint).
  // The UI offers presets as shortcuts but ANY non-empty string is valid — we do
  // NOT validate against the old 5 rigid outcomes.
  if (typeof outcome !== 'string' || outcome.trim().length === 0) {
    console.warn('[log-visit] rejected: empty outcome');
    return NextResponse.json({ error: 'outcome is required' }, { status: 400 });
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    console.warn('[log-visit] rejected: notes not a string');
    return NextResponse.json({ error: 'notes must be a string' }, { status: 400 });
  }
  if (
    next_visit_date !== undefined &&
    next_visit_date !== null &&
    typeof next_visit_date !== 'string'
  ) {
    console.warn('[log-visit] rejected: next_visit_date not a string');
    return NextResponse.json(
      { error: 'next_visit_date must be a YYYY-MM-DD string' },
      { status: 400 },
    );
  }

  try {
    // (a) Confirm the store exists. getStore() awaits client(), which awaits
    // runMigrations() exactly once before any read/write — so the schema is
    // guaranteed migrated (CHECK constraint dropped) before we insert below.
    const store = await getStore(store_id);
    if (!store) {
      console.warn('[log-visit] rejected: unknown store_id', store_id);
      return NextResponse.json({ error: 'Unknown store_id' }, { status: 404 });
    }

    // (c) DB write. insertVisit() also awaits client()/migrations internally.
    console.log('[log-visit] DB write attempted for store', store_id);
    const visit = await insertVisit({
      store_id,
      outcome: outcome.trim(),
      notes: (notes as string | undefined) ?? null,
      next_visit_date: (next_visit_date as string | undefined) ?? null,
    });

    console.log('[log-visit] response sent: 201, visit id', visit.id);
    return NextResponse.json({ ok: true, visit }, { status: 201 });
  } catch (err) {
    // Surface DB/Turso connection or constraint failures instead of a silent
    // 500 with no body, so the client shows a real message.
    console.error('[log-visit] DB write failed:', err);
    return NextResponse.json(
      {
        error: 'Failed to save visit',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
