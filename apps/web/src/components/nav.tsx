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
    <nav className="flex items-center gap-6 text-sm">
      {NAV.map((n) => {
        const active = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`transition-colors ${active ? 'text-label underline decoration-blue decoration-2 underline-offset-[6px]' : 'text-label2 hover:text-label'}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

