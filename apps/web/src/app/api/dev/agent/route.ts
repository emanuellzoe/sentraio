// Local sandbox only: play the agent from the dashboard so the demo can be driven live.
import { analyzeTx, fetchTx } from '@sentineli/core';
import { Guard } from '@sentineli/guard';
import { actions } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { chain, isLocalMode } from '@/lib/config';
import { devAccount, txHash } from '@/lib/server';

const SCENARIOS = {
  honest: { receiver: 'shop-payments.test.near', amount: '2', label: 'Pay invoice #1041 to shop-payments' },
  injected: { receiver: 'shop-payrnents.test.near', amount: '5', label: 'Prompt-injected invoice: pay shop-payrnents' },
  new_vendor: { receiver: 'coffee-corner.test.near', amount: '1.5', label: 'First order from coffee-corner' },
  bypass: { receiver: 'shop-payrnents.test.near', amount: '5', label: 'Compromised code calls the vault directly' },
} as const;

const yocto = (near: string) => (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString();

export async function POST(request: Request) {
  if (!isLocalMode()) return Response.json({ error: 'Agent simulator runs on the local sandbox only.' }, { status: 400 });
  const { scenario } = (await request.json()) as { scenario: keyof typeof SCENARIOS };
  const s = SCENARIOS[scenario];
  if (!s) return Response.json({ error: 'unknown scenario' }, { status: 400 });
  const action = { type: 'near_transfer' as const, receiver_id: s.receiver, amount: yocto(s.amount) };

  try {
    if (scenario === 'bypass') {
      const sent = await devAccount('agent').signAndSendTransaction({
        receiverId: chain.vaultId, actions: [actions.functionCall('execute', { action, approval: null }, 100_000_000_000_000n, 0n)], waitUntil: 'FINAL', throwOnFailure: false,
      });
      const report = analyzeTx(await fetchTx({ hash: txHash(sent), sender: chain.agentId, rpcUrl: chain.rpcUrl }));
      return Response.json({ label: s.label, status: report.verdict === 'rejected' ? 'vault_rejected' : report.verdict, message: report.headline, txHash: report.hash, signer: chain.agentId });
    }

    // a warn waits for the operator; answer the request as soon as the guard starts waiting
    let markWaiting: () => void = () => {};
    const waiting = new Promise<null>((r) => (markWaiting = () => r(null)));
    const guard = new Guard({
      vaultId: chain.vaultId, agentId: chain.agentId, agentKey: process.env.DEV_AGENT_KEY as KeyPairString,
      preflightUrl: process.env.PREFLIGHT_URL!, agentToken: process.env.PREFLIGHT_AGENT_TOKEN!, rpcUrl: chain.rpcUrl,
      onEvent: (e) => e.stage === 'waiting_for_human' && markWaiting(),
    });
    const pay = guard.pay(action);
    const first = await Promise.race([pay, waiting]);
    if (!first) {
      pay.catch(() => {});
      return Response.json({ label: s.label, status: 'needs_human', message: 'Waiting for the operator — see the Operator page.' });
    }
    return Response.json({ label: s.label, status: first.status, message: first.message, txHash: first.txHash, signer: chain.agentId, signals: first.check.decision.signals });
  } catch (e) {
    return Response.json({ label: s.label, status: 'error', message: (e as Error).message }, { status: 502 });
  }
}
