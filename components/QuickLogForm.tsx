'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VisitOutcome } from '@/lib/types';
import { outcomeMeta } from '@/lib/ui-meta';
import VoiceNoteButton from './VoiceNoteButton';

const PRESETS: VisitOutcome[] = [
  'interested',
  'follow_up',
  'no_answer',
  'not_interested',
];

/** Always-visible visit logger embedded on the store detail page. */
export default function QuickLogForm({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState<VisitOutcome | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [notes, setNotes] = useState('');
  const [dictating, setDictating] = useState(false);
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const effective = customMode ? customText.trim() : preset;

  async function save() {
    if (!effective) {
      setError(customMode ? 'Type a custom outcome first.' : 'Pick an outcome.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/log-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          outcome: effective,
          notes: notes.trim() || null,
          next_visit_date:
            preset === 'follow_up' && !customMode && nextVisitDate
              ? nextVisitDate
              : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save visit');
      }
      setPreset(null);
      setCustomMode(false);
      setCustomText('');
      setNotes('');
      setNextVisitDate('');
      setSaved(true);
      router.refresh();
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save visit');
    } finally {
      setSaving(false);
    }
  }

  const chip = (selected: boolean) =>
    `rounded-full border-[1.5px] px-3 py-2 text-[13px] font-semibold transition-all duration-200 active:scale-[0.97] ${
      selected
        ? 'border-brand bg-brand-light text-brand'
        : 'border-edge bg-white text-ink-soft hover:bg-[#F9FAFB]'
    }`;

  return (
    <div id="quick-log">
      <h2 className="mb-3 text-[16px] font-semibold text-ink">Log a visit</h2>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((o) => {
          const meta = outcomeMeta(o);
          const selected = !customMode && preset === o;
          return (
            <button
              key={o}
              onClick={() => {
                setPreset(o);
                setCustomMode(false);
              }}
              className={chip(selected)}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
        <button
          onClick={() => {
            setCustomMode(true);
            setPreset(null);
          }}
          className={chip(customMode)}
        >
          ✏️ Custom
        </button>
      </div>

      {customMode && (
        <input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          autoFocus
          placeholder="e.g. Left samples, ask for owner Thursday"
          className="mt-3 w-full rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none focus:border-brand"
        />
      )}

      {preset === 'follow_up' && !customMode && (
        <div className="mt-3">
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">
            Come back on
          </label>
          <input
            type="date"
            value={nextVisitDate}
            onChange={(e) => setNextVisitDate(e.target.value)}
            className="w-full rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none focus:border-brand"
          />
        </div>
      )}

      <div className="mt-3 flex items-start gap-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add notes…"
          className={`w-full resize-none rounded-xl border-[1.5px] border-edge px-3.5 py-3 text-[15px] outline-none focus:border-brand ${
            dictating ? 'italic' : ''
          }`}
        />
        <VoiceNoteButton
          value={notes}
          onChange={setNotes}
          onListeningChange={setDictating}
        />
      </div>

      {error && <p className="mt-2 text-[14px] text-danger">{error}</p>}
      {saved && <p className="mt-2 text-[14px] text-success">Visit saved.</p>}

      <button
        onClick={save}
        disabled={saving}
        className="mt-3 min-h-[48px] w-full rounded-xl bg-accent text-[15px] font-semibold text-white transition-all duration-200 hover:bg-accent-dark active:scale-[0.99] disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save visit'}
      </button>
    </div>
  );
}
