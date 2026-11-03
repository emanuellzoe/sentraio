import type { Metadata } from 'next';
import { Vault } from './vault';

export const metadata: Metadata = { title: 'Vault — Sentraio' };

export default function VaultPage() {
  return (
    <div className="space-y-8">
      <div className="fade-in space-y-3">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Vault</h1>
        <p className="max-w-3xl text-lg text-label2">
          The on-chain mandate your agent cannot step outside of: limits, strikes, freeze, and the panic switch.
        </p>
      </div>
      <Vault />
    </div>
  );
}
