import type { Metadata } from 'next';
import { Playground } from './playground';

export const metadata: Metadata = { title: 'Clearance — Sentraio' };

export default function ClearancePage() {
  return (
    <div className="space-y-8">
      <div className="fade-in space-y-3">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Clearance</h1>
        <p className="max-w-3xl text-lg text-label2">
          Before the agent signs anything, every check runs: the vault mandate, the vault&apos;s own code, the receiver,
          the shared blocklist, and look-alike names. The worst result wins: <b>allow</b> signs, <b>warn</b> asks a
          human, <b>block</b> refuses.
        </p>
      </div>
      <Playground />
    </div>
  );
}
