// Dry run of Preflight: shows every signal, signs nothing.
import { runPreflight } from '@sentineli/preflight';
import type { AgentAction } from '@sentineli/preflight';
import { chain, isLocalMode } from '@/lib/config';

export async function POST(request: Request) {
  const body = (await request.json()) as { vaultId?: string; agentId?: string; action?: AgentAction };
  if (!body.action?.receiver_id || !body.action?.amount || !body.action?.type) return Response.json({ error: 'action with type, receiver_id and amount required' }, { status: 400 });
  try {
    const decision = await runPreflight(
      { vaultId: body.vaultId || chain.vaultId, agentId: body.agentId || chain.agentId, action: body.action },
      {
        rpcUrl: chain.rpcUrl,
        network: chain.mode === 'mainnet' ? 'mainnet' : 'testnet',
        nearblocksUrl: isLocalMode() ? null : undefined,
        registryId: chain.registryId || undefined,
        expectedVaultCodeHashes: chain.vaultCodeHash ? [chain.vaultCodeHash] : undefined,
        knownAccounts: (process.env.PREFLIGHT_KNOWN_ACCOUNTS ?? (isLocalMode() ? 'shop-payments.test.near' : '')).split(',').filter(Boolean),
      },
    );
    return Response.json(decision);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
