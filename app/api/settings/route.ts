import { NextResponse, type NextRequest } from 'next/server';
import {
  getStartingAddress,
  getVisitWindow,
  setStartingAddress,
  setVisitWindow,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  const [window, address] = await Promise.all([
    getVisitWindow(),
    getStartingAddress(),
  ]);
  return NextResponse.json({
    starting_address: address ?? '',
    visit_time_start: window.start,
    visit_time_end: window.end,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { starting_address, visit_time_start, visit_time_end } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof starting_address !== 'string' ||
    starting_address.trim().length === 0
  ) {
    return NextResponse.json(
      { error: 'starting_address is required' },
      { status: 400 },
    );
  }
  if (typeof visit_time_start !== 'string' || !HHMM.test(visit_time_start)) {
    return NextResponse.json(
      { error: 'visit_time_start must be HH:MM (24-hour)' },
      { status: 400 },
    );
  }
  if (typeof visit_time_end !== 'string' || !HHMM.test(visit_time_end)) {
    return NextResponse.json(
      { error: 'visit_time_end must be HH:MM (24-hour)' },
      { status: 400 },
    );
  }
  if (visit_time_end <= visit_time_start) {
    return NextResponse.json(
      { error: 'End time must be after start time' },
      { status: 400 },
    );
  }

  await setStartingAddress(starting_address);
  await setVisitWindow(visit_time_start, visit_time_end);

  return NextResponse.json({
    ok: true,
    starting_address: await getStartingAddress(),
    ...(await getVisitWindow()),
  });
}
