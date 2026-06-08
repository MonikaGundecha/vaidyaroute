'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import LeafMark from './LeafMark';
import { EDIT_LOCATION_EVENT } from './SettingsBar';
import { FIND_NEW_STORES_EVENT } from './Header';

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M9 18l-5 2V6l5-2 6 2 5-2v14l-5 2-6-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 7h6M8 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M4 9l1-5h14l1 5M5 9v10h14V9M5 9h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4m0-12.8l-1.4 1.4m-10 10l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ITEMS = [
  { href: '/', label: 'Route', Icon: RouteIcon },
  { href: '/history', label: 'Log Book', Icon: BookIcon },
  { href: '/stores', label: 'Stores', Icon: StoreIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const onRoutePage = pathname === '/';

  function openSettings() {
    if (onRoutePage) {
      window.dispatchEvent(new CustomEvent(EDIT_LOCATION_EVENT));
    } else {
      router.push('/');
    }
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[200px] flex-col border-r border-edge md:flex">
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-2.5 border-b border-edge px-4 py-6"
      >
        <LeafMark className="h-6 w-6" />
        <span className="text-[18px] font-extrabold text-brand">
          VaidyaRoute
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {ITEMS.map(({ href, label, Icon }) => {
          const active =
            href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-[10px] px-4 py-2.5 text-[14px] font-medium transition-colors duration-200 ${
                active
                  ? 'bg-brand-light text-brand'
                  : 'text-ink-soft hover:bg-black/[0.03]'
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}

        <button
          onClick={openSettings}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-4 py-2.5 text-[14px] font-medium text-ink-soft transition-colors duration-200 hover:bg-black/[0.03]"
        >
          <GearIcon />
          Settings
        </button>
      </nav>

      {/* Regenerate Plan — route page only */}
      {onRoutePage && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(FIND_NEW_STORES_EVENT))}
          className="m-4 flex h-11 items-center justify-center gap-2 rounded-[10px] bg-accent text-[14px] font-semibold text-white transition-all duration-200 hover:bg-accent-dark active:scale-[0.97]"
        >
          ↻ Regenerate Plan
        </button>
      )}
    </aside>
  );
}
