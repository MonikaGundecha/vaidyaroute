# VaidyaRoute — Project Brief for Claude Code

## What we're building
A web app that helps a solo salesperson in Philadelphia sell an ayurvedic product by automatically planning an optimized evening sales route each day. He works a day job and visits stores after work (roughly 5–8 PM). The app gives him 3–4 nearby potential customer stops each evening, ordered by walking/transit route, with store info and a way to log outcomes.

---

## Tech stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: SQLite via `better-sqlite3` (local file, simple and free)
- **APIs**: Google Places API (New) + Google Maps Distance Matrix API
- **Hosting**: Vercel (free tier)
- **Language**: TypeScript

---

## Project structure to create

```
/app
  /page.tsx              → Today's route page (main screen)
  /history/page.tsx      → Past visits log
  /api
    /generate-route/route.ts   → Core API route: fetch stores, filter, cluster, optimize
    /log-visit/route.ts        → Save visit outcome to DB
    /stores/route.ts           → List all known stores
/lib
  /places.ts             → Google Places API wrapper
  /routing.ts            → Distance Matrix + nearest-neighbor route optimizer
  /db.ts                 → SQLite setup and queries
  /clustering.ts         → Group stores into geographic clusters of 3-4
/components
  /RouteCard.tsx         → Today's route display with map link
  /StoreCard.tsx         → Individual store info card
  /VisitLogger.tsx       → Modal/form to log visit outcome
  /Map.tsx               → Embedded Google Map of tonight's stops
/.env.local              → API keys (never commit this)
```

---

## Environment variables needed

Create `.env.local` with:
```
GOOGLE_MAPS_API_KEY=your_key_here
```

The starting address and evening visit window are **not** env vars — they're
configured in-app on the Settings page and stored in the `settings` table
(see the schema below). The visit window defaults to 17:00–20:00 until changed.

---

## Database schema (SQLite)

```sql
-- Stores discovered via Places API
CREATE TABLE stores (
  id TEXT PRIMARY KEY,           -- Google Place ID
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT,
  category TEXT,                 -- yoga_studio | health_food | wellness | spa | gym | other
  google_rating REAL,
  hours_json TEXT,               -- raw opening_hours from Places API
  discovered_at TEXT DEFAULT (datetime('now'))
);

-- Every time he visits (or decides to skip) a store
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT REFERENCES stores(id),
  visited_at TEXT DEFAULT (datetime('now')),
  outcome TEXT CHECK(outcome IN ('interested','not_interested','follow_up','no_answer','closed')),
  notes TEXT,
  next_visit_date TEXT           -- optional: schedule a follow-up
);

-- Daily generated routes
CREATE TABLE routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  store_ids_json TEXT NOT NULL,  -- ordered array of Place IDs
  generated_at TEXT DEFAULT (datetime('now'))
);

-- In-app config: starting address + visit window (set on the Settings page)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,          -- starting_address | visit_time_start | visit_time_end
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

---

## Core logic to implement

### 1. Store discovery (`/lib/places.ts`)
Query Google Places API (Nearby Search) with these search terms near the starting address:
- "yoga studio"
- "ayurvedic"
- "health food store"
- "wellness center"
- "natural grocery"
- "holistic health"
- "meditation center"
- "pilates studio"
- "organic store"
- "spa"

For each result, fetch: name, address, lat/lng, phone, opening_hours, rating, place_id.
Store results in the `stores` table. Skip duplicates (upsert by place_id).

### 2. Evening hours filter (`/lib/places.ts`)
Filter stores to only those open during the configured visit window (default 5–8 PM).
Parse the `opening_hours.periods` array from Places API response.
Today is `new Date()` — check if today's day_of_week has a period that overlaps 17:00–20:00.

### 3. Geographic clustering (`/lib/clustering.ts`)
After filtering, cluster remaining stores into groups of 3–4 using simple geographic proximity:
- Use k-means or greedy nearest-neighbor starting from the user's starting point
- Exclude stores already visited (check `visits` table — any store with a visit in the last 30 days)
- Exclude stores marked `not_interested` permanently
- Prioritize `follow_up` stores (visited before, asked to come back)
- Pick the cluster whose centroid is closest to the starting point for tonight

### 4. Route optimization (`/lib/routing.ts`)
For the selected cluster of 3–4 stores:
- Call Google Maps Distance Matrix API to get travel times between all pairs
- Run nearest-neighbor TSP starting from the user's starting address
- Return ordered array of stores with estimated travel time between each stop

### 5. Daily route generation (`/api/generate-route/route.ts`)
- Check if a route already exists for today in `routes` table → return it if so
- Otherwise: run discovery (or use cached stores) → filter → cluster → optimize → save → return
- Response shape:
```json
{
  "date": "2024-01-15",
  "stops": [
    {
      "order": 1,
      "store": { "id": "...", "name": "...", "address": "...", "phone": "...", "category": "...", "rating": 4.2 },
      "travel_from_previous": "8 min walk",
      "maps_url": "https://maps.google.com/?q=...",
      "last_visit": null,
      "outcome_history": []
    }
  ],
  "total_estimated_time": "45 min",
  "google_maps_directions_url": "https://www.google.com/maps/dir/..."
}
```

### 6. Visit logging (`/api/log-visit/route.ts`)
POST endpoint that saves a visit outcome. Body:
```json
{ "store_id": "...", "outcome": "interested", "notes": "...", "next_visit_date": "2024-01-22" }
```

---

## UI — Main page (`/app/page.tsx`)

Design a clean, mobile-first interface (he'll use this on his phone between stops).

**Header**: "Tonight's Route" + today's date + "Regenerate" button

**Route summary bar**: Total stops · Estimated time · Neighborhood name

**Stop cards** (one per store, in order):
- Stop number badge (1, 2, 3, 4)
- Store name + category tag (color-coded: yoga=green, health food=orange, wellness=purple, etc.)
- Address + "Open until X PM"
- Star rating
- Travel time from previous stop (e.g. "→ 6 min walk")
- Last visit badge if visited before (e.g. "Visited 3 days ago · Follow-up")
- Three action buttons: [📍 Directions] [📞 Call] [✓ Log Visit]

**Log Visit modal** (slides up when "Log Visit" tapped):
- Store name at top
- Outcome buttons: Interested ✓ | Not Interested ✗ | Follow-up 📅 | No Answer | Closed
- Notes text area
- If "Follow-up": date picker for next visit
- Save button

**Bottom nav**: Route | History | All Stores

---

## UI — History page (`/app/history/page.tsx`)
List of all past visits grouped by date, showing store name, outcome badge, and notes.

---

## UI — All Stores page
Table/list of all discovered stores with their visit status, last outcome, and a "Force include tonight" toggle.

---

## Important implementation notes

1. **Cache Places API results aggressively** — store everything in SQLite. Only re-query Google if a store hasn't been refreshed in 7 days. This keeps API costs near zero.

2. **Regenerate button** — if he doesn't like tonight's route, he can regenerate to get the next-best cluster.

3. **No auth needed** — this is a single-user local app. No login.

4. **Error handling** — if Google API is down or quota exceeded, fall back to showing cached stores from SQLite sorted by distance.

5. **Google Maps directions URL** — always generate a multi-stop directions URL so he can open the full route in Google Maps with one tap:
   `https://www.google.com/maps/dir/START/STOP1/STOP2/STOP3/STOP4`

6. **Mobile-first** — he uses this on his phone while commuting. Large tap targets, clear typography, works offline for viewing (route already loaded).

---

## How to start

Run these commands first:
```bash
npx create-next-app@latest vaidyaroute --typescript --tailwind --app
cd vaidyaroute
npm install better-sqlite3 @types/better-sqlite3
```

Then build in this order:
1. Database setup (`/lib/db.ts`) + schema migration
2. Places API wrapper (`/lib/places.ts`)
3. Clustering + routing logic (`/lib/clustering.ts`, `/lib/routing.ts`)
4. API routes
5. UI components
6. Main page

---

## Definition of done (MVP)
- [ ] Opens on phone, shows 3–4 stores for tonight
- [ ] Each store is open during 5–8 PM today
- [ ] Stores are geographically close to each other
- [ ] Route is ordered to minimize travel time
- [ ] Tapping "Directions" opens Google Maps with the full route
- [ ] Tapping "Log Visit" saves an outcome
- [ ] Previously visited stores don't repeat (within 30 days)
- [ ] "Follow-up" stores get surfaced again after their scheduled date

