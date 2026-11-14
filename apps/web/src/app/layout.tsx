import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { NavLinks } from '@/components/nav';
import { WalletButton, WalletProvider } from '@/components/wallet';
import './globals.css';

// Apple devices render SF Pro through -apple-system; Inter is the fallback elsewhere.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL('https://sentraio.vercel.app'),
  title: 'Sentraio — a guard for AI agents that hold money on NEAR',
  description: 'Counterparty checks, sandbox simulation and an approval-gated vault for AI agents on NEAR, plus Tx X-Ray to explain what happened.',
  openGraph: {
    title: 'Sentraio — AI agents can hold money now. Sentraio decides what they may do with it.',
    description: 'Clearance checks who gets paid and simulates the payment. Vault enforces the mandate on-chain. Tx X-Ray explains every failure. Built on NEAR.',
    url: '/',
    siteName: 'Sentraio',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <WalletProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-blue focus:p-2 focus:text-white">
            Skip to content
          </a>
          <header className="ios-nav sticky top-0 z-30">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-2.5">
              <Link href="/" className="text-[1.05rem] font-semibold tracking-tight">
                Sentraio
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <NavLinks />
                <WalletButton />
              </div>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">{children}</main>
          <footer className="border-t border-sep">
            <div className="mono-label mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6">
              <p>Sentraio — Rules on-chain. Reasons in plain words. Built on NEAR.</p>
              <a href="#main" className="hover:text-label">Back to top ↑</a>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
