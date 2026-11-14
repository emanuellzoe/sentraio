'use client';

import { useState } from 'react';
import { SignalList } from '@/components/signals';
import type { UiSignal } from '@/components/signals';
import { Notice, postJson, Skeleton, usePoll, XRayLink } from '@/components/ui';
import { Badge, Panel } from '@/components/verdict';
import { useWallet, walletEnabled } from '@/components/wallet';

interface Check {
  id: string;
  status: string;
  by?: string;
  reason?: string;
  at?: string;
  txHash?: string;
  decision: {
    verdict: string;
    summary: string;
    signals: UiSignal[];
    request: { vaultId: string; agentId: string; action: { type: string; receiver_id: string; amount: string; token?: string } };
  };
}

const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? 'testnet';

const amount = (a: Check['decision']['request']['action']) =>
  a.type === 'near_transfer' ? `${Number(BigInt(a.amount) / 10n ** 18n) / 1e6} NEAR` : `${a.amount} ${a.token}`;

export function Operator() {
  const { data, error, reload } = usePoll<{ pending: Check[]; checks: Check[]; unavailable?: boolean }>('/api/operator', 2000);
  const [busy, setBusy] = useState<string>();
  const wallet = useWallet();

  const answer = async (id: string, decision: 'confirm' | 'reject') => {
    const reason = decision === 'reject' ? prompt('Why reject? (recorded)') ?? undefined : undefined;
    setBusy(id + decision);
    try {
      let proof;
      if (walletEnabled) {
        // the owner's wallet signs exactly the server's challenge (NEP-413); no transaction, no fee
        if (!wallet.accountId) throw new Error('Connect the vault owner wallet first.');
        const ch = await (await fetch(`/api/operator/challenge?id=${id}&decision=${decision}`)).json();
        const signed = await wallet.signMessage(ch.message, ch.recipient, ch.nonce);
        proof = { signed, nonce: ch.nonce, at: ch.at };
      }
      await postJson('/api/operator', { id, decision, reason, proof });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (!data && !error) return <Skeleton />;
  if (!data || data.unavailable) {
    // No Clearance service behind this deployment (the public demo holds no keys), or it cannot be reached.
    return (
      <div className="grid gap-8 border-t border-sep pt-6 md:grid-cols-12 md:gap-10">
        <p className="mono-label md:col-span-3">Local only</p>
        <div className="space-y-6 md:col-span-9">
          <h2 className="max-w-2xl text-2xl font-medium tracking-[-0.02em]">The operator queue runs next to the Clearance service, on your machine.</h2>
          <p className="max-w-2xl text-label2">
            This hosted demo holds no keys, so there is no Clearance service behind it and nothing can arrive in the queue. When a payment comes back as <span className="font-medium text-label">warn</span>, this page is where the vault owner approves or rejects it with a wallet signature. The agent cannot answer for itself.
          </p>
          <pre className="overflow-x-auto border border-sep p-5 font-mono text-sm leading-relaxed">{`pnpm install && pnpm build:contracts
pnpm dev:chain      # local sandbox with the real contracts
pnpm web            # this dashboard, now with the queue live`}</pre>
          <p className="max-w-2xl text-sm text-label2">
            Or read the transcript of the five situations, including the warn the owner approved:{' '}
            <a className="ios-link" href="https://github.com/emanuellzoe/sentraio/blob/main/demo/attack/last-run.log" target="_blank" rel="noreferrer">demo/attack/last-run.log ↗</a>
          </p>
          {error && <p className="mono-label">Service error: {error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Panel title={`Waiting for a human (${data.pending.length})`}>
        {data.pending.length === 0 ? (
          <p className="text-sm text-label2">Nothing to decide. Warns from Clearance show up here; the agent cannot answer them itself.</p>
        ) : (
          <ul className="space-y-4">
            {data.pending.map((c) => (
              <li key={c.id} className="fade-in rounded-2xl border-[0.5px] border-orange/40 bg-orange/5 p-1">
                <div className="space-y-3 p-4">
                  <p className="text-lg">
                    <b>{c.decision.request.agentId}</b> wants to send <b>{amount(c.decision.request.action)}</b> to <b>{c.decision.request.action.receiver_id}</b>
                  </p>
                  <p className="text-sm text-label2">{c.decision.summary}</p>
                  <SignalList signals={c.decision.signals} />
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button className="ios-btn" disabled={!!busy} onClick={() => answer(c.id, 'confirm')}>{busy === c.id + 'confirm' ? 'Signing…' : 'Approve'}</button>
                    <button className="ios-btn ios-btn-danger-tinted" disabled={!!busy} onClick={() => answer(c.id, 'reject')}>{busy === c.id + 'reject' ? '…' : 'Reject'}</button>
                  </div>
                  <p className="text-xs text-label3">Your wallet signs a message (no transaction, no fee). Approving re-runs every check first; if anything turned into a block meanwhile, it is refused anyway.</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Decision log">
        {data.checks.length === 0 ? <p className="text-sm text-label2">No decisions yet.</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-[0.5px] border-sep text-left text-xs font-semibold uppercase text-label2">
                <th className="py-1">Time</th><th>Result</th><th>Payment</th><th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((c) => (
                <tr key={c.id} className="border-b-[0.5px] border-sep align-top last:border-0">
                  <td className="py-3 pr-3 whitespace-nowrap text-xs text-label2">{c.at ? new Date(c.at).toLocaleTimeString() : ''}</td>
                  <td className="py-2 pr-3"><Badge value={c.status === 'approved' ? 'allow' : c.status === 'needs_human' ? 'needs_human' : 'refused'} /><br /><span className="text-xs">{c.status}{c.by ? ` by ${c.by}` : ''}</span></td>
                  <td className="py-2 pr-3 break-all">{amount(c.decision.request.action)} → {c.decision.request.action.receiver_id}</td>
                  <td className="py-2">
                    {c.reason ?? c.decision.summary}
                    {c.txHash && <p className="mt-1 text-xs"><XRayLink tx={c.txHash} network={NETWORK} /></p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
