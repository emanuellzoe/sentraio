import type { CheckResponse } from '@sentineli/preflight';
import { chain } from '@/lib/config';
import { operator } from '@/lib/server';

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export async function GET() {
  try {
    const [pending, checks] = await Promise.all([operator<CheckResponse[]>('/pending'), operator<(CheckResponse & { at: string })[]>('/checks')]);
    return Response.json({ pending, checks });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { id, decision, reason, by } = (await request.json()) as { id: string; decision: 'confirm' | 'reject'; reason?: string; by?: string };
  if (!/^[0-9a-f-]{36}$/.test(id) || !['confirm', 'reject'].includes(decision)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    // recorded as who decided: the connected wallet account, else the configured owner
    // (identification only; access to this route is what authorizes the operator)
    const who = by && ACCOUNT.test(by) ? by : chain.ownerId || 'operator';
    const result = await operator<CheckResponse>(`/pending/${id}/${decision}`, { by: who, reason });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
