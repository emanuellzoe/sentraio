import type { Metadata } from 'next';
import { IBM_Plex_Mono, Silkscreen } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const silkscreen = Silkscreen({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-silkscreen' });
const plexMono = IBM_Plex_Mono({ weight: ['400', '600'], subsets: ['latin'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Sentineli — a guard for AI agents that hold money on NEAR',
  description: 'Counterparty checks, sandbox simulation and an approval-gated vault for AI agents on NEAR, plus FailLens to explain what happened.',
};

const NAV = [
  { href: '/#layers', label: 'Layers' },
  { href: '/#attack', label: 'Attack' },
  { href: '/faillens', label: 'FailLens' },
  { href: '/preflight', label: 'Preflight' },
  { href: '/operator', label: 'Operator' },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-ink focus:p-2 focus:text-paper">Skip to content</a>
        <header className="sticky top-0 z-20 border-b-2 border-ink bg-paper">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
            <Link href="/" className="flex items-center gap-2 font-pixel text-2xl tracking-tight">
              SENTINELI<span className="cursor" />
              <span className="badge badge-solid text-[10px]">AGNT-SEC</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-1 font-pixel text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="px-2 py-1 hover:bg-ink hover:text-paper">
                  {n.label}
                </Link>
              ))}
              <Link href="/vault" className="px-btn px-btn-solid ml-2 py-1">Vault →</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">{children}</main>
        <footer className="dither-25 border-t-2 border-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6">
            <p className="flex items-center gap-2 bg-paper px-2 font-pixel text-xs">
              <span className="badge badge-solid">SENTINELI</span> Code enforces. AI explains. Built for builders on NEAR.
            </p>
            <a href="#main" className="bg-paper px-2 font-pixel text-xs underline decoration-2 underline-offset-2">Back to top ↑</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
