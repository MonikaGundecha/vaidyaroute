'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Context-aware back link for the store detail page. Reads ?from to decide
 * where "back" points: the plan (default) or the Stores list.
 */
export default function BackLink() {
  const from = useSearchParams().get('from');
  const { href, label } =
    from === 'stores'
      ? { href: '/stores', label: 'Stores' }
      : { href: '/', label: "Today's Plan" };

  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand"
    >
      ← {label}
    </Link>
  );
}
