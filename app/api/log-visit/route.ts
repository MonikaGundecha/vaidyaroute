import { NextResponse, type NextRequest } from 'next/server';
import { insertVisit, getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { store_id, outcome, notes, next_visit_date } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof store_id !== 'string' || store_id.length === 0) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  }
  // Outcome is free-form text now; the UI offers presets as shortcuts but any
  // non-empty string is valid.
  if (typeof outcome !== 'string' || outcome.trim().length === 0) {
    return NextResponse.json(
      { error: 'outcome is required' },
      { status: 400 },
    );
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return NextResponse.json({ error: 'notes must be a string' }, { status: 400 });
  }
  if (
    next_visit_date !== undefined &&
    next_visit_date !== null &&
    typeof next_visit_date !== 'string'
  ) {
    return NextResponse.json(
      { error: 'next_visit_date must be a YYYY-MM-DD string' },
      { status: 400 },
    );
  }
  if (!(await getStore(store_id))) {
    return NextResponse.json({ error: 'Unknown store_id' }, { status: 404 });
  }

  const visit = await insertVisit({
    store_id,
    outcome: outcome.trim(),
    notes: (notes as string | undefined) ?? null,
    next_visit_date: (next_visit_date as string | undefined) ?? null,
  });

  return NextResponse.json({ ok: true, visit }, { status: 201 });
}
