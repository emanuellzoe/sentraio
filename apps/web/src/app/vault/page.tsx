import type { Metadata } from 'next';
import { Vault } from './vault';

export const metadata: Metadata = { title: 'Vault — Sentineli' };

export default function VaultPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="font-pixel text-4xl">Vault</h1>
        <p className="max-w-3xl">
          The on-chain mandate your agent cannot step outside of: limits, strikes, freeze, and the panic switch.
        </p>
      </div>
      <Vault />
    </div>
  );
}
