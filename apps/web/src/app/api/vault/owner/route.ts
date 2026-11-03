// Local sandbox only: owner actions signed with the dev owner key. On testnet the
// browser wallet signs these calls instead.
import { actions } from 'near-api-js';
import { chain, isLocalMode } from '@/lib/config';
import { devAccount, txHash } from '@/lib/server';

// vault methods the dashboard may call as the owner; the client sends the deposit
// (1 yoctoNEAR for owner methods, 0 for freeze, the amount for deposit_near)
const OWNER_METHODS = new Set(['unfreeze', 'trigger_panic', 'clear_panic', 'set_mandate', 'remove_agent', 'withdraw', 'freeze', 'deposit_near']);

export async function POST(request: Request) {
  if (!isLocalMode()) return Response.json({ error: 'Sign this with your wallet on testnet.' }, { status: 400 });
  const { method, args, deposit } = (await request.json()) as { method: string; args?: Record<string, unknown>; deposit?: string };
  if (!OWNER_METHODS.has(method)) return Response.json({ error: `method ${method} not allowed` }, { status: 400 });
  if (!/^\d{1,40}$/.test(deposit ?? '1')) return Response.json({ error: 'bad deposit' }, { status: 400 });
  try {
    const sent = await devAccount('owner').signAndSendTransaction({
      receiverId: chain.vaultId,
      actions: [actions.functionCall(method, args ?? {}, method === 'trigger_panic' ? 200_000_000_000_000n : 100_000_000_000_000n, BigInt(deposit ?? '1'))],
      waitUntil: 'FINAL',
      throwOnFailure: false,
    });
    return Response.json({ txHash: txHash(sent), signer: chain.ownerId });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
