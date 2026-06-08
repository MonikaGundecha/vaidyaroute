import { NextResponse, type NextRequest } from 'next/server';
import {
  getStore,
  setSkippedUntil,
  deleteRoutesForDate,
} from '@/lib/db';
import { todayString } from '@/lib/clustering';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Skip for today": suppress a store for today only and drop today's saved
 * route so the next /api/generate-route call rebuilds it without the skipped
 * store. The store re-enters the pool tomorrow (no forced re-insertion — it
 * only reappears if it naturally fits a nearby cluster).
 * Body: { store_id, skip? } — pass skip:false to un-skip.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { store_id, skip } = (body ?? {}) as Record<string, unknown>;

  if (typeof store_id !== 'string' || store_id.length === 0) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  }
  if (skip !== undefined && typeof skip !== 'boolean') {
    return NextResponse.json({ error: 'skip must be a boolean' }, { status: 400 });
  }
  if (!(await getStore(store_id))) {
    return NextResponse.json({ error: 'Unknown store_id' }, { status: 404 });
  }

  const doSkip = skip ?? true;
  const today = todayString();
  // Same-day exclusion: skipped_until = today; candidate selection excludes
  // stores whose skipped_until >= today, so it returns to the pool tomorrow.
  const until = doSkip ? today : null;

  // 1) Persist the skip flag in the DB.
  await setSkippedUntil(store_id, until);

  // 2) Drop today's saved route(s) so the next generate rebuilds without it.
  const removed = await deleteRoutesForDate(today);

  return NextResponse.json({
    ok: true,
    store_id,
    skipped_until: until,
    routes_cleared: removed,
  });
}
