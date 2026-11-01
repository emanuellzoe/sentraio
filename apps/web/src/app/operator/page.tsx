import type { Metadata } from 'next';
import { Operator } from './operator';

export const metadata: Metadata = { title: 'Operator — Sentineli' };

export default function OperatorPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="font-pixel text-4xl">Operator</h1>
        <p className="max-w-3xl">
          When Preflight says <b>warn</b>, a person decides. Only the operator token can approve, so a compromised
          agent cannot wave its own payment through.
        </p>
      </div>
      <Operator />
    </div>
  );
}
