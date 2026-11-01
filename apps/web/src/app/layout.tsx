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
  { href: '/', label: 'Home' },
  { href: '/faillens', label: 'FailLens' },
  { href: '/vault', label: 'Vault' },
  { href: '/operator', label: 'Operator' },
  { href: '/preflight', label: 'Preflight' },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <header className="border-b-2 border-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
            <Link href="/" className="font-pixel text-2xl tracking-tight">
              SENTINELI<span className="cursor" />
            </Link>
            <nav className="flex flex-wrap gap-1 font-pixel text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="px-2 py-1 hover:bg-ink hover:text-paper">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">{children}</main>
        <footer className="dither-25 border-t-2 border-ink">
          <div className="mx-auto max-w-6xl px-5 py-6">
            <p className="inline-block bg-paper px-2 font-pixel text-xs">Code enforces. AI explains. Built for the NEAR Hackathon 2026.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
