import { NextResponse, type NextRequest } from 'next/server';
import { generateRoute } from '@/lib/route-service';

// better-sqlite3 is a native module + we always want fresh data, never static.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const regenerate = searchParams.get('regenerate') === 'true';
    const indexParam = searchParams.get('index');
    const index =
      indexParam !== null && indexParam !== '' ? Number(indexParam) : undefined;

    const result = await generateRoute({ regenerate, index });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate route' },
      { status: 500 },
    );
  }
}
