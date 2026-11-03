import { strict as assert } from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { base58Encode, nep413Hash, OPERATOR_RECIPIENT, operatorMessage, verifyOperatorProof } from '../src/index.ts';
import type { OperatorProof } from '../src/index.ts';
import { FakeChain } from './fake-chain.ts';

const VAULT = 'vault.testnet';
const OWNER = 'owner.testnet';

function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pk = `ed25519:${base58Encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
  return {
    pk,
    signMessage: (message: string, nonce: Buffer, recipient: string) =>
      sign(null, nep413Hash(message, nonce, recipient), privateKey).toString('base64'),
  };
}

function setup(keys: Record<string, 'FullAccess' | 'FunctionCall'>) {
  const c = new FakeChain().view(VAULT, 'get_owner', () => OWNER);
  const base = c.fetch;
  c.fetch = (async (url: string, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body));
    if (params.request_type === 'view_access_key') {
      const p = keys[`${params.account_id}/${params.public_key}`];
      return new Response(JSON.stringify(p
        ? { result: { nonce: 0, permission: p === 'FullAccess' ? 'FullAccess' : { FunctionCall: { receiver_id: 'x', method_names: [] } } } }
        : { error: { cause: { name: 'UNKNOWN_ACCESS_KEY' }, message: 'no key' } }));
    }
    return base(url, init);
  }) as typeof fetch;
  return c;
}

const proofFor = (w: ReturnType<typeof wallet>, accountId: string, decision: string, checkId: string, at: number, recipient = OPERATOR_RECIPIENT): OperatorProof => {
  const nonce = Buffer.alloc(32, 7);
  return { signed: { accountId, publicKey: w.pk, signature: w.signMessage(operatorMessage(decision, checkId, at), nonce, recipient) }, nonce: nonce.toString('base64'), at };
};

test('owner full-access key signature is accepted once', async () => {
  const w = wallet();
  const c = setup({ [`${OWNER}/${w.pk}`]: 'FullAccess' });
  const seenNonces = new Set<string>();
  const now = 1_000_000;
  const opts = { fetchImpl: c.fetch, seenNonces, now: () => now };
  const p = proofFor(w, OWNER, 'confirm', 'abc', now);
  assert.equal(await verifyOperatorProof(p, { decision: 'confirm', checkId: 'abc', vaultId: VAULT }, opts), OWNER);
  await assert.rejects(verifyOperatorProof(p, { decision: 'confirm', checkId: 'abc', vaultId: VAULT }, opts), /already used/);
});

test('rejects: other check or decision, stale, non-owner, function-call key, wrong recipient', async () => {
  const w = wallet();
  const stranger = wallet();
  const c = setup({ [`${OWNER}/${w.pk}`]: 'FullAccess', [`${OWNER}/${stranger.pk}`]: 'FunctionCall', [`eve.testnet/${stranger.pk}`]: 'FullAccess' });
  const now = 1_000_000;
  const opts = () => ({ fetchImpl: c.fetch, seenNonces: new Set<string>(), now: () => now });
  const exp = { decision: 'confirm', checkId: 'abc', vaultId: VAULT };
  await assert.rejects(verifyOperatorProof(proofFor(w, OWNER, 'confirm', 'other', now), exp, opts()), /bad signature/);
  await assert.rejects(verifyOperatorProof(proofFor(w, OWNER, 'reject', 'abc', now), exp, opts()), /bad signature/);
  await assert.rejects(verifyOperatorProof(proofFor(w, OWNER, 'confirm', 'abc', now - 10 * 60_000), exp, opts()), /too old/);
  await assert.rejects(verifyOperatorProof(proofFor(stranger, 'eve.testnet', 'confirm', 'abc', now), exp, opts()), /only the vault owner/);
  await assert.rejects(verifyOperatorProof(proofFor(stranger, OWNER, 'confirm', 'abc', now), exp, opts()), /not a full-access key/);
  await assert.rejects(verifyOperatorProof(proofFor(w, OWNER, 'confirm', 'abc', now, 'evil-app'), exp, opts()), /bad signature/);
});
