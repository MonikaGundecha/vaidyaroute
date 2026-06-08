import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exposes the Maps JavaScript API key to the browser for Places Autocomplete.
 * The key is meant to be referrer-restricted in the Google Cloud console.
 */
export async function GET() {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  return NextResponse.json({ key: key === 'your_key_here' ? '' : key });
}
