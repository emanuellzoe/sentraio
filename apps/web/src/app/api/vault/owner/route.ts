// Local sandbox only: owner actions signed with the dev owner key. On testnet the
// browser wallet signs these calls instead.
import { actions } from 'near-api-js';
import { chain, isLocalMode } from '@/lib/config';
import { devAccount, txHash } from '@/lib/server';

// owner-only vault methods that need 1 yoctoNEAR (full-access key confirmation)
const OWNER_METHODS = new Set(['unfreeze', 'trigger_panic', 'clear_panic', 'set_mandate', 'remove_agent', 'withdraw']);
const NO_DEPOSIT = new Set(['freeze']);

export async function POST(request: Request) {
  if (!isLocalMode()) return Response.json({ error: 'Sign this with your wallet on testnet.' }, { status: 400 });
  const { method, args } = (await request.json()) as { method: string; args?: Record<string, unknown> };
  if (!OWNER_METHODS.has(method) && !NO_DEPOSIT.has(method)) return Response.json({ error: `method ${method} not allowed` }, { status: 400 });
  try {
    const sent = await devAccount('owner').signAndSendTransaction({
      receiverId: chain.vaultId,
      actions: [actions.functionCall(method, args ?? {}, 100_000_000_000_000n, NO_DEPOSIT.has(method) ? 0n : 1n)],
      waitUntil: 'FINAL',
      throwOnFailure: false,
    });
    return Response.json({ txHash: txHash(sent), signer: chain.ownerId });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
