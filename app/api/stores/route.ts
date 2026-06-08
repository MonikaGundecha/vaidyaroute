import { NextResponse, type NextRequest } from 'next/server';
import {
  getAllStores,
  getLatestVisitsByStore,
  getStore,
  setForceInclude,
  setIrrelevant,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [latest, allStores] = await Promise.all([
    getLatestVisitsByStore(),
    getAllStores(),
  ]);
  const stores = allStores.map((s) => {
    const lv = latest.get(s.id);
    return {
      ...s,
      last_outcome: lv?.outcome ?? null,
      last_visited_at: lv?.visited_at ?? null,
      next_visit_date: lv?.next_visit_date ?? null,
    };
  });
  return NextResponse.json({ count: stores.length, stores });
}

/**
 * Update a store flag. Body must include `store_id` plus exactly one of:
 *   - `force_include` (boolean) — pin into / unpin from tonight's route
 *   - `is_irrelevant` (boolean) — permanently exclude / re-include in routes
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { store_id, force_include, is_irrelevant } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof store_id !== 'string' || store_id.length === 0) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  }
  if (!(await getStore(store_id))) {
    return NextResponse.json({ error: 'Unknown store_id' }, { status: 404 });
  }

  if (typeof force_include === 'boolean') {
    await setForceInclude(store_id, force_include);
    return NextResponse.json({ ok: true, store_id, force_include });
  }
  if (typeof is_irrelevant === 'boolean') {
    await setIrrelevant(store_id, is_irrelevant);
    return NextResponse.json({ ok: true, store_id, is_irrelevant });
  }

  return NextResponse.json(
    { error: 'Provide a boolean force_include or is_irrelevant' },
    { status: 400 },
  );
}
