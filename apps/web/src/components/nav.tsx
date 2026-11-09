'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from './icons';

const NAV = [
  { href: '/xray', label: 'Tx X-Ray' },
  { href: '/clearance', label: 'Clearance' },
  { href: '/vault', label: 'Vault' },
  { href: '/operator', label: 'Operator' },
];

/** Segmented-control style navigation; the active page is the raised segment. */
export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5 rounded-full bg-fill p-0.5 text-sm">
      {NAV.map((n) => {
        const active = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 font-medium transition-colors ${active ? 'bg-card text-label shadow-sm' : 'text-label2 hover:text-label'}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Shield mark, icon only: no tile, no gradient. */
export function AppIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c2.6 1.4 5 2 7 2v6.5c0 4.6-3 7.6-7 9.5-4-1.9-7-4.9-7-9.5V5c2 0 4.4-.6 7-2z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}

const TABS = [
  { href: '/xray', label: 'Tx X-Ray', icon: 'xray' },
  { href: '/clearance', label: 'Clearance', icon: 'magnifier' },
  { href: '/vault', label: 'Vault', icon: 'lock' },
  { href: '/operator', label: 'Operator', icon: 'operator' },
] as const;

/** Floating glass tab bar at the bottom: icons only, the current page is the one at full strength. */
export function BottomBar() {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="ios-glass fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-label={t.label}
            title={t.label}
            aria-current={active ? 'page' : undefined}
            className={`flex h-11 w-14 items-center justify-center rounded-full transition-colors ${active ? 'bg-fill text-label' : 'text-label2 hover:text-label'}`}
          >
            <Glyph name={t.icon} className="h-6 w-6" />
          </Link>
        );
      })}
    </nav>
  );
}
