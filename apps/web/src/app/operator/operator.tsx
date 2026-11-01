'use client';

import { useState } from 'react';
import { SignalList } from '@/components/signals';
import type { UiSignal } from '@/components/signals';
import { postJson, usePoll } from '@/components/ui';
import { Badge, Panel } from '@/components/verdict';

interface Check {
  id: string;
  status: string;
  by?: string;
  reason?: string;
  at?: string;
  decision: {
    verdict: string;
    summary: string;
    signals: UiSignal[];
    request: { vaultId: string; agentId: string; action: { type: string; receiver_id: string; amount: string; token?: string } };
  };
}

const amount = (a: Check['decision']['request']['action']) =>
  a.type === 'near_transfer' ? `${Number(BigInt(a.amount) / 10n ** 18n) / 1e6} NEAR` : `${a.amount} ${a.token}`;

export function Operator() {
  const { data, error, reload } = usePoll<{ pending: Check[]; checks: Check[] }>('/api/operator', 2000);
  const [busy, setBusy] = useState<string>();

  const answer = async (id: string, decision: 'confirm' | 'reject') => {
    const reason = decision === 'reject' ? prompt('Why reject? (recorded)') ?? undefined : undefined;
    setBusy(id + decision);
    try {
      await postJson('/api/operator', { id, decision, reason });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (error && !data) {
    return (
      <div className="hatch px-frame p-4">
        <p className="inline-block bg-paper px-2">Preflight service unreachable: {error}. Is <code>pnpm dev:chain</code> running?</p>
      </div>
    );
  }
  if (!data) return <div className="dither-25 px-frame h-40" />;

  return (
    <div className="space-y-8">
      <Panel title={`Waiting for a human (${data.pending.length})`}>
        {data.pending.length === 0 ? (
          <p className="text-sm">Nothing to decide. Warns from Preflight show up here; the agent cannot answer them itself.</p>
        ) : (
          <ul className="space-y-6">
            {data.pending.map((c) => (
              <li key={c.id} className="dither-25 border-2 border-ink p-3">
                <div className="space-y-3 bg-paper p-3">
                  <p className="text-lg">
                    <b>{c.decision.request.agentId}</b> wants to send <b>{amount(c.decision.request.action)}</b> to <b>{c.decision.request.action.receiver_id}</b>
                  </p>
                  <p className="text-sm">{c.decision.summary}</p>
                  <SignalList signals={c.decision.signals} />
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button className="px-btn" disabled={!!busy} onClick={() => answer(c.id, 'confirm')}>{busy === c.id + 'confirm' ? 'Signing…' : 'Approve'}</button>
                    <button className="px-btn" disabled={!!busy} onClick={() => answer(c.id, 'reject')}>{busy === c.id + 'reject' ? '…' : 'Reject'}</button>
                  </div>
                  <p className="text-xs">Approving re-runs every check first; if anything turned into a block meanwhile, it is refused anyway.</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Decision log">
        {data.checks.length === 0 ? <p className="text-sm">No decisions yet.</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left font-pixel text-xs">
                <th className="py-1">Time</th><th>Result</th><th>Payment</th><th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((c) => (
                <tr key={c.id} className="border-b border-ink align-top last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{c.at ? new Date(c.at).toLocaleTimeString() : ''}</td>
                  <td className="py-2 pr-3"><Badge value={c.status === 'approved' ? 'allow' : c.status === 'needs_human' ? 'needs_human' : 'refused'} /><br /><span className="text-xs">{c.status}{c.by ? ` by ${c.by}` : ''}</span></td>
                  <td className="py-2 pr-3 break-all">{amount(c.decision.request.action)} → {c.decision.request.action.receiver_id}</td>
                  <td className="py-2">{c.reason ?? c.decision.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
