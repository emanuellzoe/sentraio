// Panic = 1) vault.trigger_panic (freeze every agent, drain balances to the owner)
//         2) delete the agent's function-call key (needs the agent account's full-access key,
//            which the owner keeps; the agent process never had it).
import { KeyPair, actions } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { chain, isLocalMode } from '@/lib/config';
import { devAccount, txHash } from '@/lib/server';

export async function POST() {
  if (!isLocalMode()) return Response.json({ error: 'Sign this with your wallet on testnet.' }, { status: 400 });
  const steps: { step: string; txHash?: string; signer?: string; error?: string }[] = [];
  try {
    const sent = await devAccount('owner').signAndSendTransaction({
      receiverId: chain.vaultId, actions: [actions.functionCall('trigger_panic', {}, 200_000_000_000_000n, 1n)], waitUntil: 'FINAL', throwOnFailure: false,
    });
    steps.push({ step: 'vault frozen and drained to owner', txHash: txHash(sent), signer: chain.ownerId });
  } catch (e) {
    steps.push({ step: 'trigger_panic', error: (e as Error).message });
  }
  try {
    const agentKey = KeyPair.fromString(process.env.DEV_AGENT_KEY as KeyPairString).getPublicKey();
    const sent = await devAccount('agentFull').signAndSendTransaction({
      receiverId: chain.agentId, actions: [actions.deleteKey(agentKey)], waitUntil: 'FINAL', throwOnFailure: false,
    });
    steps.push({ step: `agent key ${agentKey.toString().slice(0, 16)}… deleted`, txHash: txHash(sent), signer: chain.agentId });
  } catch (e) {
    steps.push({ step: 'delete agent key', error: (e as Error).message.split('\n')[0] });
  }
  return Response.json({ steps });
}
