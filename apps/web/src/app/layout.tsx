import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { AppIcon, BottomBar, NavLinks } from '@/components/nav';
import { WalletButton, WalletProvider } from '@/components/wallet';
import './globals.css';

// Apple devices render SF Pro through -apple-system; Inter is the fallback elsewhere.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Sentraio — a guard for AI agents that hold money on NEAR',
  description: 'Counterparty checks, sandbox simulation and an approval-gated vault for AI agents on NEAR, plus Tx X-Ray to explain what happened.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
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
              <Link href="/" className="flex items-center gap-2.5 text-[1.05rem] font-semibold tracking-tight">
                <AppIcon />
                Sentraio
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <NavLinks />
                <WalletButton />
              </div>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-28 pt-10">{children}</main>
          <footer className="border-t-[0.5px] border-sep">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-label2">
              <p className="flex items-center gap-2">
                <AppIcon size={20} /> Sentraio · Rules on-chain. Reasons in plain words. Built on NEAR.
              </p>
              <a href="#main" className="ios-link">Back to top</a>
            </div>
          </footer>
          <BottomBar />
        </WalletProvider>
      </body>
    </html>
  );
}
