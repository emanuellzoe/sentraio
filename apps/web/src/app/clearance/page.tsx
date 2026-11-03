import type { Metadata } from 'next';
import { Playground } from './playground';

export const metadata: Metadata = { title: 'Clearance — Countersign' };

export default function ClearancePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="font-pixel text-4xl">Clearance</h1>
        <p className="max-w-3xl">
          Before the agent signs anything, every check runs: the vault mandate, the vault&apos;s own code, the receiver,
          the shared blocklist, and look-alike names. The worst result wins: <b>allow</b> signs, <b>warn</b> asks a
          human, <b>block</b> refuses.
        </p>
      </div>
      <Playground />
    </div>
  );
}
