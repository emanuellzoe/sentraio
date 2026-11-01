import type { CheckResponse } from '@sentineli/preflight';
import { chain } from '@/lib/config';
import { operator } from '@/lib/server';

export async function GET() {
  try {
    const [pending, checks] = await Promise.all([operator<CheckResponse[]>('/pending'), operator<(CheckResponse & { at: string })[]>('/checks')]);
    return Response.json({ pending, checks });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { id, decision, reason } = (await request.json()) as { id: string; decision: 'confirm' | 'reject'; reason?: string };
  if (!/^[0-9a-f-]{36}$/.test(id) || !['confirm', 'reject'].includes(decision)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    // the operator page acts for the vault owner; with a wallet this becomes the signed-in account
    const result = await operator<CheckResponse>(`/pending/${id}/${decision}`, { by: chain.ownerId || 'operator', reason });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
