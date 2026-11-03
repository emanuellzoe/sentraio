import type { Metadata } from 'next';
import { Operator } from './operator';

export const metadata: Metadata = { title: 'Operator — Sentraio' };

export default function OperatorPage() {
  return (
    <div className="space-y-8">
      <div className="fade-in space-y-3">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Operator</h1>
        <p className="max-w-3xl text-lg text-label2">
          When Clearance says <b>warn</b>, the vault owner decides. Approving takes a signed message from the owner&apos;s
          wallet, so a compromised agent cannot wave its own payment through.
        </p>
      </div>
      <Operator />
    </div>
  );
}
