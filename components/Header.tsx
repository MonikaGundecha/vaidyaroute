'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Event the route page listens for to regenerate the plan. */
export const FIND_NEW_STORES_EVENT = 'vaidya:find-new-stores';

export default function Header() {
  const pathname = usePathname();
  const onRoutePage = pathname === '/';

  function regenerate() {
    window.dispatchEvent(new CustomEvent(FIND_NEW_STORES_EVENT));
  }

  return (
    <header className="flex items-center justify-between px-4 pt-6 md:hidden">
      <Link
        href="/"
        className="text-[24px] font-extrabold text-brand"
        style={{ letterSpacing: '-0.5px' }}
      >
        VaidyaRoute
      </Link>

      {onRoutePage && (
        <button
          onClick={regenerate}
          className="flex h-[42px] items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-accent-dark active:scale-[0.97] md:px-[22px]"
        >
          <span aria-hidden className="text-[16px] leading-none">
            ↻
          </span>
          <span className="hidden sm:inline">Regenerate Plan</span>
        </button>
      )}
    </header>
  );
}
