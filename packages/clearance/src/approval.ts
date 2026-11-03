import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { viewFunction } from '@countersign/core';
import type { ViewOptions } from '@countersign/core';
import type { Decision } from './types.ts';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

export function base58Encode(buf: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(buf).toString('hex') || '0'}`);
  let out = '';
  for (; n > 0n; n /= 58n) out = ALPHABET[Number(n % 58n)] + out;
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

// PKCS#8 wrapper for a raw 32-byte ed25519 seed, so node:crypto can use NEAR keys directly.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

/** NEAR secret key ("ed25519:<base58 of seed||pubkey>") -> node KeyObject + NEAR public key string. */
export function guardianKey(secretKey: string) {
  const [curve, data] = secretKey.split(':');
  if (curve !== 'ed25519' || !data) throw new Error('guardian key must be "ed25519:<base58>"');
  const raw = base58Decode(data);
  if (raw.length !== 64 && raw.length !== 32) throw new Error('unexpected ed25519 key length');
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = `ed25519:${base58Encode(spki.subarray(spki.length - 32))}`;
  return { privateKey, publicKey };
}

export interface Approval {
  signature: string;
  expires_at_ns: string;
}

export class ApprovalRefused extends Error {}

export interface ApproveOptions extends ViewOptions {
  guardianSecretKey: string;
  /** Required to sign a `warn` decision: the human who confirmed it. */
  humanConfirmedBy?: string;
  /** Approval lifetime; the vault caps it at 10 minutes. Default 60 s. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Signs exactly the message the vault will verify (fetched from the vault itself, so
 * encoding can never drift). block -> refuse; warn -> refuse unless a human confirmed.
 */
export async function approve(decision: Decision, opts: ApproveOptions): Promise<Approval> {
  if (decision.verdict === 'block') throw new ApprovalRefused(`blocked: ${decision.summary}`);
  if (decision.verdict === 'warn' && !opts.humanConfirmedBy) throw new ApprovalRefused(`needs human confirmation: ${decision.summary}`);

  const { vaultId, agentId, action } = decision.request;
  const expires = BigInt((opts.now?.() ?? Date.now()) + (opts.ttlMs ?? 60_000)) * 1_000_000n;
  const message = await viewFunction<string>(vaultId, 'get_approval_message', { agent_id: agentId, action, expires_at_ns: expires.toString() }, opts);
  return signMessage(message, opts.guardianSecretKey, expires);
}

export function signMessage(message: string, guardianSecretKey: string, expiresAtNs: bigint): Approval {
  const { privateKey } = guardianKey(guardianSecretKey);
  return { signature: sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'), expires_at_ns: expiresAtNs.toString() };
}

