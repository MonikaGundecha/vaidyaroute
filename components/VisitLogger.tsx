'use client';

import { useState } from 'react';
import type { VisitOutcome } from '@/lib/types';
import { ALL_OUTCOMES, outcomeMeta } from '@/lib/ui-meta';
import VoiceNoteButton from './VoiceNoteButton';

interface VisitLoggerProps {
  storeId: string;
  storeName: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function VisitLogger({
  storeId,
  storeName,
  onClose,
  onSaved,
}: VisitLoggerProps) {
  // Either a preset shortcut is selected, or the user is typing a custom one.
  const [preset, setPreset] = useState<VisitOutcome | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [notes, setNotes] = useState('');
  const [dictating, setDictating] = useState(false);
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The outcome string actually saved.
  const effectiveOutcome = customMode ? customText.trim() : preset;

  async function save() {
    if (!effectiveOutcome) {
      setError(
        customMode ? 'Type a custom outcome first.' : 'Pick an outcome first.',
      );
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
          outcome: effectiveOutcome,
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
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save visit');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl animate-[slideup_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-300" />
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
          Log visit
        </div>
        <h2 className="mb-4 text-lg font-bold text-gray-900">{storeName}</h2>

        <div className="grid grid-cols-2 gap-2">
          {ALL_OUTCOMES.map((o) => {
            const meta = outcomeMeta(o);
            const selected = !customMode && preset === o;
            return (
              <button
                key={o}
                onClick={() => {
                  setPreset(o);
                  setCustomMode(false);
                }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                  selected
                    ? 'border-brand bg-brand-light text-brand ring-2 ring-brand/30'
                    : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
                }`}
              >
                <span>{meta.icon}</span>
                {meta.label}
              </button>
            );
          })}
          <button
            onClick={() => {
              setCustomMode(true);
              setPreset(null);
            }}
            className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              customMode
                ? 'border-brand bg-brand-light text-brand ring-2 ring-brand/30'
                : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
            }`}
          >
            <span>✏️</span>
            Custom
          </button>
        </div>

        {customMode && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Custom outcome
            </label>
            <input
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              autoFocus
              placeholder="e.g. Left samples, speak to owner Thursday"
              className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base"
            />
          </div>
        )}

        {preset === 'follow_up' && !customMode && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Come back on
            </label>
            <input
              type="date"
              value={nextVisitDate}
              onChange={(e) => setNextVisitDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base"
            />
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Notes
          </label>
          <div className="flex items-start gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What happened? Who did you talk to?"
              className={`w-full resize-none rounded-xl border border-gray-300 px-3 py-3 text-base ${
                dictating ? 'italic' : ''
              }`}
            />
            <VoiceNoteButton
              value={notes}
              onChange={setNotes}
              onListeningChange={setDictating}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-300 py-3.5 text-base font-semibold text-gray-700 active:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-[2] rounded-xl bg-brand py-3.5 text-base font-semibold text-white shadow-sm active:bg-brand-dark disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </div>
      </div>
    </div>
  );
}
