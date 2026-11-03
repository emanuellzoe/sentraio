// NEP-413 signed messages (wallet "sign message"), verified server-side.
// https://github.com/near/NEPs/blob/master/neps/nep-0413.md
import { createHash, createPublicKey, verify } from 'node:crypto';
import { RPC_URLS, RpcError, viewFunction } from '@countersign/core';
import type { ViewOptions } from '@countersign/core';
import { base58Decode } from './approval.ts';

const NEP413_TAG = 2 ** 31 + 413;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  /** base64 ed25519 signature */
  signature: string;
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
};

/** sha256(borsh(tag) || borsh(payload)) — the bytes a NEP-413 wallet signs. */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Buffer {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const payload = Buffer.concat([
    str(message),
    Buffer.from(nonce),
    str(recipient),
    callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(callbackUrl)]),
  ]);
  return createHash('sha256').update(Buffer.concat([u32(NEP413_TAG), payload])).digest();
}

export function verifyNep413Signature(signed: SignedMessage, message: string, nonce: Uint8Array, recipient: string): boolean {
  const [curve, b58] = signed.publicKey.split(':');
  if (curve !== 'ed25519' || !b58) return false;
  const raw = base58Decode(b58);
  if (raw.length !== 32) return false;
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
  return verify(null, nep413Hash(message, nonce, recipient), key, Buffer.from(signed.signature, 'base64'));
}

/** The signature proves key ownership; the chain must also confirm it is a full-access key of the account. */
export async function isFullAccessKey(accountId: string, publicKey: string, view: ViewOptions): Promise<boolean> {
  try {
    const r = await rpcViewAccessKey(accountId, publicKey, view);
    return r.permission === 'FullAccess';
  } catch (e) {
    if (e instanceof RpcError && /UNKNOWN_ACCESS_KEY|UNKNOWN_ACCOUNT/.test(e.code)) return false;
    throw e;
  }
}

async function rpcViewAccessKey(accountId: string, publicKey: string, { network = 'testnet', rpcUrl, fetchImpl = fetch }: ViewOptions) {
  const res = await fetchImpl(rpcUrl ?? RPC_URLS[network].regular, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 'countersign', method: 'query', params: { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey } }),
  });
  const body = (await res.json()) as { result?: { permission: unknown }; error?: { cause?: { name?: string }; message?: string } };
  if (body.error) throw new RpcError(body.error.cause?.name ?? 'RPC_ERROR', body.error.message ?? 'view_access_key failed');
  return body.result!;
}

export interface OperatorProof {
  signed: SignedMessage;
  /** base64 of the 32-byte nonce the wallet signed */
  nonce: string;
  /** milliseconds since epoch, embedded in the message */
  at: number;
}

export const OPERATOR_RECIPIENT = 'countersign-operator';
export const operatorMessage = (decision: string, checkId: string, at: number) => `Countersign operator: ${decision} check ${checkId} at ${at}`;

/**
 * Accepts an operator decision only if it is signed now, once, by a full-access key of the
 * vault owner. Returns the owner account id, or throws with the reason.
 */
export async function verifyOperatorProof(
  proof: OperatorProof,
  expected: { decision: string; checkId: string; vaultId: string },
  opts: ViewOptions & { seenNonces: Set<string>; maxAgeMs?: number; now?: () => number },
): Promise<string> {
  const now = opts.now?.() ?? Date.now();
  if (!Number.isFinite(proof.at) || Math.abs(now - proof.at) > (opts.maxAgeMs ?? 5 * 60_000)) throw new Error('signature is too old');
  if (opts.seenNonces.has(proof.nonce)) throw new Error('signature already used');
  const nonce = Buffer.from(proof.nonce, 'base64');
  const message = operatorMessage(expected.decision, expected.checkId, proof.at);
  if (!verifyNep413Signature(proof.signed, message, nonce, OPERATOR_RECIPIENT)) throw new Error('bad signature');
  const owner = await viewFunction<string>(expected.vaultId, 'get_owner', {}, opts);
  if (proof.signed.accountId !== owner) throw new Error(`only the vault owner (${owner}) can decide`);
  if (!(await isFullAccessKey(owner, proof.signed.publicKey, opts))) throw new Error('key is not a full-access key of the owner');
  opts.seenNonces.add(proof.nonce);
  return owner;
}
