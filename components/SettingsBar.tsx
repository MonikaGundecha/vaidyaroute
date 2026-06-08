'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

interface SettingsState {
  starting_address: string;
  visit_time_start: string;
  visit_time_end: string;
}

// Minimal shape of the Google Places Autocomplete we use (no @types dependency).
interface GooglePlace {
  formatted_address?: string;
  geometry?: { location?: { lat(): number; lng(): number } };
}
interface GoogleAutocomplete {
  addListener(event: string, cb: () => void): void;
  getPlace(): GooglePlace;
}
type GoogleMaps = {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        opts?: Record<string, unknown>,
      ) => GoogleAutocomplete;
    };
  };
};
function getGoogle(): GoogleMaps | undefined {
  return (globalThis as unknown as { google?: GoogleMaps }).google;
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${period}`;
}

// --- tiny inline icons ------------------------------------------------------
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" aria-hidden>
      <path
        d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6z"
        fill="none"
        stroke="#1D6B4A"
        strokeWidth="2"
      />
      <circle cx="12" cy="8" r="2.2" fill="#1D6B4A" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#E8943A" strokeWidth="2" />
      <path
        d="M12 7v5l3.5 2"
        fill="none"
        stroke="#E8943A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] flex-shrink-0 text-ink-muted"
      aria-hidden
    >
      <path
        d="M4 20h4L18.5 9.5a2 2 0 000-2.8l-1.2-1.2a2 2 0 00-2.8 0L4 16v4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Event other components can fire to open the location editor. */
export const EDIT_LOCATION_EVENT = 'vaidya:edit-location';

interface SettingsBarProps {
  /** Called after settings are saved so the route can be regenerated. */
  onSaved: () => void;
}

export default function SettingsBar({ onSaved }: SettingsBarProps) {
  const [form, setForm] = useState<SettingsState>({
    starting_address: '',
    visit_time_start: '17:00',
    visit_time_end: '20:00',
  });
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<'location' | 'hours' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapsKey, setMapsKey] = useState('');
  const [mapsReady, setMapsReady] = useState(false);
  const dirty = useRef(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const autocompleteAttached = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, kRes] = await Promise.all([
          fetch('/api/settings', { cache: 'no-store' }),
          fetch('/api/maps-key', { cache: 'no-store' }),
        ]);
        const data = await sRes.json();
        setForm({
          starting_address: data.starting_address ?? '',
          visit_time_start: data.visit_time_start ?? '17:00',
          visit_time_end: data.visit_time_end ?? '20:00',
        });
        if (!data.starting_address) setOpen('location');
        const kData = await kRes.json().catch(() => ({}));
        if (kData.key) setMapsKey(kData.key);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function persist(next: SettingsState): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save settings');
      }
      dirty.current = false;
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  // Let the empty state's "Update location" button open this editor.
  useEffect(() => {
    const handler = () => {
      setOpen('location');
      document
        .getElementById('starting_address')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    window.addEventListener(EDIT_LOCATION_EVENT, handler);
    return () => window.removeEventListener(EDIT_LOCATION_EVENT, handler);
  }, []);

  function update<K extends keyof SettingsState>(key: K, value: string) {
    dirty.current = true;
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  async function save(): Promise<void> {
    if (!dirty.current && form.starting_address) {
      setOpen(null);
      return;
    }
    await persist(form);
    setOpen(null);
  }

  // Attach Places Autocomplete once the script is ready and the location
  // editor (with its input) is mounted.
  useEffect(() => {
    if (open !== 'location' || !mapsReady || autocompleteAttached.current) return;
    const input = addressRef.current;
    const google = getGoogle();
    if (!input || !google) return;

    const autocomplete = new google.maps.places.Autocomplete(input, {
      fields: ['formatted_address', 'geometry'],
      types: ['establishment', 'geocode'],
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const formatted = place.formatted_address;
      if (!formatted) return;
      const next: SettingsState = { ...form, starting_address: formatted };
      dirty.current = true;
      setForm(next);
      persist(next).then(() => setOpen(null));
    });
    autocompleteAttached.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapsReady]);

  if (!loaded) {
    return <div className="mb-4 h-[44px] animate-pulse rounded-full bg-black/5" />;
  }

  const addressShort = form.starting_address
    ? form.starting_address.split(',')[0]
    : 'Set your address';
  const hoursLabel = `${formatTime(form.visit_time_start)} – ${formatTime(
    form.visit_time_end,
  )}`;

  const bubbleBase =
    'flex h-[44px] flex-1 items-center gap-2.5 rounded-full border-[1.5px] bg-white px-5 text-[14px] font-medium text-ink transition-colors duration-200';

  return (
    <section className="mb-4">
      {mapsKey && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
          strategy="afterInteractive"
          onLoad={() => setMapsReady(true)}
          onReady={() => setMapsReady(true)}
        />
      )}

      <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        Where are you starting?
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => setOpen((o) => (o === 'location' ? null : 'location'))}
          className={`${bubbleBase} border-brand hover:bg-brand-light`}
          aria-expanded={open === 'location'}
        >
          <PinIcon />
          <span className="flex-1 truncate text-left">{addressShort}</span>
          <PencilIcon />
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => (o === 'hours' ? null : 'hours'))}
          className={`${bubbleBase} border-accent hover:bg-accent-light`}
          aria-expanded={open === 'hours'}
        >
          <ClockIcon />
          <span className="flex-1 truncate text-left">{hoursLabel}</span>
          <PencilIcon />
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl border border-edge bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
          {open === 'location' ? (
            <div>
              <label
                htmlFor="starting_address"
                className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
              >
                Starting address
              </label>
              <input
                id="starting_address"
                ref={addressRef}
                autoComplete="off"
                value={form.starting_address}
                onChange={(e) => update('starting_address', e.target.value)}
                placeholder="Start typing your address…"
                className="w-full rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-brand"
              />
            </div>
          ) : (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Selling hours
              </div>
              <div className="flex items-center gap-3">
                <input
                  aria-label="Selling hours start"
                  type="time"
                  value={form.visit_time_start}
                  onChange={(e) => update('visit_time_start', e.target.value)}
                  className="flex-1 rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none focus:border-accent"
                />
                <span className="text-ink-muted">→</span>
                <input
                  aria-label="Selling hours end"
                  type="time"
                  value={form.visit_time_end}
                  onChange={(e) => update('visit_time_end', e.target.value)}
                  className="flex-1 rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-full px-4 py-2 text-[14px] font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full bg-brand px-5 py-2 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-brand-dark active:scale-[0.97] disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Update route'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
