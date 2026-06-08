'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoreActionsProps {
  storeId: string;
  forceInclude: boolean;
  isIrrelevant: boolean;
  /** skipped_until date (YYYY-MM-DD) or null. */
  skippedUntil: string | null;
}

export default function StoreActions({
  storeId,
  forceInclude,
  isIrrelevant,
  skippedUntil,
}: StoreActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<'force' | 'irrelevant' | 'skip' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const isSkipped = skippedUntil != null && skippedUntil >= today;

  async function patch(body: Record<string, unknown>, which: 'force' | 'irrelevant') {
    setPending(which);
    setError(null);
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, ...body }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError('Could not update — try again.');
    } finally {
      setPending(null);
    }
  }

  async function toggleSkip() {
    setPending('skip');
    setError(null);
    try {
      const res = await fetch('/api/skip-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, skip: !isSkipped }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError('Could not update — try again.');
    } finally {
      setPending(null);
    }
  }

  function scrollToLog() {
    document
      .getElementById('quick-log')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const btn =
    'flex h-[44px] items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] text-[13px] font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-50';

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        {/* Row 1 */}
        <button
          onClick={scrollToLog}
          className={`${btn} border-accent bg-accent text-white hover:bg-accent-dark`}
        >
          ✓ Log a visit
        </button>
        <button
          onClick={() => patch({ force_include: !forceInclude }, 'force')}
          disabled={pending !== null || isIrrelevant}
          className={`${btn} ${
            forceInclude
              ? 'border-brand bg-brand text-white hover:bg-brand-dark'
              : 'border-brand bg-white text-brand hover:bg-brand-light'
          }`}
        >
          {forceInclude ? '📌 Added to tonight' : '＋ Add to tonight'}
        </button>

        {/* Row 2 */}
        <button
          onClick={toggleSkip}
          disabled={pending !== null || isIrrelevant}
          className={`${btn} border-edge bg-white text-ink-soft hover:bg-[#F9FAFB]`}
        >
          {isSkipped ? '↩ Un-skip' : '× Skip for today'}
        </button>
        <button
          onClick={() => {
            if (
              isIrrelevant ||
              window.confirm('Are you sure? This store will never appear again.')
            ) {
              patch({ is_irrelevant: !isIrrelevant }, 'irrelevant');
            }
          }}
          disabled={pending !== null}
          className={`${btn} ${
            isIrrelevant
              ? 'border-amber-300 bg-accent-soft text-accent-text hover:brightness-95'
              : 'border-red-300 bg-white text-danger hover:bg-red-50'
          }`}
        >
          {isIrrelevant ? '↩ Show again' : '⊘ Mark as irrelevant'}
        </button>
      </div>

      {error && <p className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}
