'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

/** Rounded-square app icon with the shield mark. */
export function AppIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="app-icon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--blue)" />
          <stop offset="1" stopColor="var(--indigo)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#app-icon)" />
      <path d="M32 12c7 3.5 13 5 18 5v15c0 11-8 18.5-18 22-10-3.5-18-11-18-22V17c5 0 11-1.5 18-5z" fill="#fff" opacity="0.95" />
      <path d="M24 33l6 6 11-12" fill="none" stroke="var(--blue)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
