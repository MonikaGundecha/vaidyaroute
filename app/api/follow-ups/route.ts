import { NextResponse } from 'next/server';
import { getFollowUpsForDate } from '@/lib/db';
import { todayString } from '@/lib/clustering';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stores with a follow-up scheduled for today. */
export async function GET() {
  return NextResponse.json({ follow_ups: getFollowUpsForDate(todayString()) });
}
