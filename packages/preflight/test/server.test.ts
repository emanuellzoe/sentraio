import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { base58Encode, startPreflightServer } from '../src/index.ts';
import type { CheckResponse } from '../src/index.ts';
import { FakeChain } from './fake-chain.ts';

const VAULT = 'vault.testnet';
const AGENT = { token: 'agent-token-0000', id: 'agent.vault.testnet' };
const OPERATOR = 'operator-token-00';

function guardianSecret() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return `ed25519:${base58Encode(Buffer.concat([privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), Buffer.alloc(32)]))}`;
}

async function setup() {
  const c = new FakeChain()
    .account(VAULT, { code_hash: 'V1' })
    .account('shop.testnet')
    .account('fresh.testnet', { ageDays: 0.5, txCount: 1 })
    .view(VAULT, 'preview', () => ({ allowed: true, reason: null, requires_approval: true, nonce: 0, spent_today: '0' }))
    .view(VAULT, 'get_mandate', () => ({ allowed_receivers: ['shop.testnet'], frozen: false }))
    .view(VAULT, 'get_approval_message', (a) => `msg|${a.expires_at_ns}`)
    .view('registry.testnet', 'get_statuses', (a) => a.account_ids.map((id: string) => [id, 'clean']));
  const server = await startPreflightServer({
    guardianSecretKey: guardianSecret(), agentToken: AGENT.token, operatorToken: OPERATOR,
    fetchImpl: c.fetch, now: () => c.now, expectedVaultCodeHashes: ['V1'], registryId: 'registry.testnet',
  });
  const call = async (path: string, token: string, body?: unknown) => {
    const res = await fetch(`${server.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { code: res.status, body: (await res.json()) as CheckResponse & { error?: string; length?: number } };
  };
  const check = (receiver: string) => call('/check', AGENT.token, { vaultId: VAULT, agentId: AGENT.id, action: { type: 'near_transfer', receiver_id: receiver, amount: '1' } });
  return { server, call, check };
}

test('warn waits for the operator; the agent token cannot confirm it', async () => {
  const { server, call, check } = await setup();
  try {
    const r = await check('fresh.testnet');
    assert.equal(r.body.status, 'needs_human');
    assert.equal(r.body.approval, undefined, 'no signature handed out for a warn');

    const selfConfirm = await call(`/pending/${r.body.id}/confirm`, AGENT.token, { by: 'agent' });
    assert.equal(selfConfirm.code, 403);

    assert.equal((await call('/pending', AGENT.token)).code, 401, 'agent cannot list the operator queue');
    assert.equal((await call('/pending', OPERATOR)).body.length, 1);

    assert.equal((await call(`/pending/${r.body.id}/confirm`, OPERATOR, {})).code, 400, 'who decided must be recorded');
    const ok = await call(`/pending/${r.body.id}/confirm`, OPERATOR, { by: 'owner.testnet' });
    assert.equal(ok.body.status, 'approved');
    assert.ok(ok.body.approval?.signature);
    assert.equal((await call(`/pending/${r.body.id}`, AGENT.token)).body.status, 'approved');
    assert.equal((await call(`/pending/${r.body.id}/confirm`, OPERATOR, { by: 'x' })).code, 409, 'answered only once');
    assert.equal((await call('/checks', AGENT.token)).code, 401, 'decision log is operator-only');
    assert.equal((await call('/checks', OPERATOR)).body.length, 1);

    const hash = '8SrPbuN53Sktmez5fzoKsRjU68PpynkY3fUaAuSWuMA';
    assert.equal((await call(`/checks/${r.body.id}/executed`, OPERATOR, { txHash: hash })).code, 401, 'only the agent reports execution');
    assert.equal((await call(`/checks/${r.body.id}/executed`, AGENT.token, { txHash: 'nope' })).code, 400);
    assert.equal((await call(`/checks/${r.body.id}/executed`, AGENT.token, { txHash: hash })).body.txHash, hash);
  } finally {
    await server.close();
  }
});

test('allow is signed immediately; missing or wrong token is rejected', async () => {
  const { server, call, check } = await setup();
  try {
    const r = await check('shop.testnet');
    assert.equal(r.body.status, 'approved', JSON.stringify(r.body.decision?.signals));
    assert.ok(r.body.approval?.expires_at_ns);
    assert.equal((await call('/check', 'nope', { vaultId: VAULT })).code, 401);
    assert.equal((await call('/check', OPERATOR, { vaultId: VAULT, agentId: AGENT.id, action: {} })).code, 401, 'operator token is not an agent token');
  } finally {
    await server.close();
  }
});

test('operator can reject a warn', async () => {
  const { server, call, check } = await setup();
  try {
    const r = await check('fresh.testnet');
    const rej = await call(`/pending/${r.body.id}/reject`, OPERATOR, { by: 'owner.testnet', reason: 'not our supplier' });
    assert.equal(rej.body.status, 'rejected');
    assert.equal(rej.body.approval, undefined);
  } finally {
    await server.close();
  }
});
