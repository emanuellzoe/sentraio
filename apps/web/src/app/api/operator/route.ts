import { verifyOperatorProof } from '@countersign/clearance';
import type { CheckResponse, OperatorProof } from '@countersign/clearance';
import { chain, isLocalMode } from '@/lib/config';
import { operator } from '@/lib/server';

// NEP-413 nonces already accepted by this server (replay protection)
const seenNonces = new Set<string>();

export async function GET() {
  if (!process.env.CLEARANCE_URL) return Response.json({ unavailable: true });
  try {
    const [pending, checks] = await Promise.all([operator<CheckResponse[]>('/pending'), operator<(CheckResponse & { at: string })[]>('/checks')]);
    return Response.json({ pending, checks });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { id, decision, reason, proof } = (await request.json()) as { id: string; decision: 'confirm' | 'reject'; reason?: string; proof?: OperatorProof };
  if (!/^[0-9a-f-]{36}$/.test(id) || !['confirm', 'reject'].includes(decision)) return Response.json({ error: 'bad request' }, { status: 400 });
  // On a real network only the vault owner, proven by a fresh NEP-413 signature from a
  // full-access key, may answer a warn. The local sandbox has no wallets, so it skips this.
  let who = chain.ownerId || 'operator';
  if (!isLocalMode()) {
    if (!proof) return Response.json({ error: 'sign with the vault owner wallet' }, { status: 401 });
    try {
      who = await verifyOperatorProof(proof, { decision, checkId: id, vaultId: chain.vaultId }, { rpcUrl: chain.rpcUrl, seenNonces });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 403 });
    }
  }
  try {
    const result = await operator<CheckResponse>(`/pending/${id}/${decision}`, { by: who, reason });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
