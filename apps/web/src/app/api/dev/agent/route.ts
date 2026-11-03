// Play the agent from the dashboard so the demo can be driven live (local sandbox, or
// testnet when the agent's function-call key is configured).
import { analyzeTx, fetchTx } from '@sentineli/core';
import { Guard } from '@sentineli/guard';
import { actions } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { chain } from '@/lib/config';
import { agentSimulatorEnabled, devAccount, txHash } from '@/lib/server';

// receivers live under the sandbox root locally and under the deployer account on testnet
const scenarios = (suffix: string, scale: number) => ({
  honest: { receiver: `shop-payments.${suffix}`, amount: String(2 * scale), label: 'Pay invoice #1041 to shop-payments' },
  injected: { receiver: `shop-payrnents.${suffix}`, amount: String(5 * scale), label: 'Prompt-injected invoice: pay shop-payrnents' },
  new_vendor: { receiver: `coffee-corner.${suffix}`, amount: String(1.5 * scale), label: 'First order from coffee-corner' },
  bypass: { receiver: `shop-payrnents.${suffix}`, amount: String(5 * scale), label: 'Compromised code calls the vault directly' },
});

const yocto = (near: string) => (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString();

export async function POST(request: Request) {
  if (!agentSimulatorEnabled()) return Response.json({ error: 'Agent simulator is not configured (DEV_AGENT_KEY, PREFLIGHT_URL).' }, { status: 400 });
  const local = chain.mode === 'local';
  // testnet amounts are 10x smaller: the faucet budget is a few NEAR
  const all = local ? scenarios('test.near', 1) : scenarios(chain.vaultId.split('.').slice(1).join('.'), 0.1);
  const { scenario } = (await request.json()) as { scenario: keyof typeof all };
  const s = all[scenario];
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
