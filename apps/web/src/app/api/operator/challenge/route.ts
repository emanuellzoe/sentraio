// The exact message the owner's wallet must sign (NEP-413) to approve or reject a warn.
import { randomBytes } from 'node:crypto';
import { OPERATOR_RECIPIENT, operatorMessage } from '@countersign/clearance';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const decision = url.searchParams.get('decision') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id) || !['confirm', 'reject'].includes(decision)) return Response.json({ error: 'bad request' }, { status: 400 });
  const at = Date.now();
  return Response.json({ message: operatorMessage(decision, id, at), recipient: OPERATOR_RECIPIENT, nonce: randomBytes(32).toString('base64'), at });
}
