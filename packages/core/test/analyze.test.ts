import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyzeTx, fetchTx, formatReport } from '../src/index.ts';
import type { RawTx } from '../src/index.ts';

const fixture = (name: string): RawTx => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const ONE = '1000000000000000000000000';

test('vault ft_transfer success: token moves vault -> shop', () => {
  const r = analyzeTx(fixture('vault-ft-transfer-ok'));
  assert.equal(r.verdict, 'success');
  const vault = r.receiver;
  assert.deepEqual(r.movements.map((m) => [m.asset, m.kind, m.from, m.to, m.amount]), [['wrap.testnet', 'transfer', vault, 'shop.test.near', ONE]]);
  assert.equal(r.net['shop.test.near']['wrap.testnet'], ONE);
  assert.equal(r.net[vault]['wrap.testnet'], `-${ONE}`);
  assert.match(r.headline, /shop\.test\.near received 1 wrap\.testnet/);
});

test('vault rejection is reported as rejected, not success', () => {
  const r = analyzeTx(fixture('vault-rejected-over-limit'));
  assert.equal(r.verdict, 'rejected');
  assert.match(r.headline, /over per tx limit/);
  assert.equal(r.movements.length, 0);
});

test('top-level success can hide an inner failure: unregistered receiver -> partial + refund', () => {
  const r = analyzeTx(fixture('vault-ft-transfer-unregistered-refund'));
  assert.equal(r.verdict, 'partial');
  assert.equal(r.failures[0].error.code, 'FT_NOT_REGISTERED');
  assert.match(r.failures[0].error.hint!, /storage_deposit\(\{"account_id":"ghost\.test\.near"\}\) on wrap\.testnet/);
  assert.equal(r.movements.length, 0, 'logs of the failed receipt must not count');
  assert.match(r.headline, /Funds were returned/);
  assert.ok(r.events.some((e) => e.standard === 'sentraio' && e.event === 'action_failed'));
});

test('NEAR transfer to a missing account: explained, and the reverted transfer is not counted', () => {
  const r = analyzeTx(fixture('vault-near-transfer-missing-account'));
  assert.equal(r.verdict, 'partial');
  assert.equal(r.failures[0].error.code, 'ACCOUNT_NOT_FOUND');
  assert.deepEqual(r.net, {});
  let refunds = 0;
  const visit = (n: typeof r.root) => { if (n.role === 'deposit_refund') refunds++; n.children.forEach(visit); };
  visit(r.root);
  assert.equal(refunds, 1, 'runtime refund of the failed 0.5 NEAR is labelled');
});

test('out of gas fails the whole transaction', () => {
  const r = analyzeTx(fixture('vault-out-of-gas'));
  assert.equal(r.verdict, 'failed');
  assert.equal(r.failures[0].error.code, 'OUT_OF_GAS');
  assert.match(r.headline, /No funds changed hands/);
});

test('ft_transfer_call into an uninitialized contract: transfer + refund net to zero', () => {
  const r = analyzeTx(fixture('ft-transfer-call-uninitialized-receiver'));
  assert.equal(r.verdict, 'partial');
  assert.equal(r.failures[0].error.code, 'CONTRACT_NOT_INITIALIZED');
  assert.deepEqual(r.movements.map((m) => m.kind), ['transfer', 'refund']);
  assert.deepEqual(r.net, {}, 'tokens went out and came back');
});

test('unknown method names the method', () => {
  const r = analyzeTx(fixture('method-not-found'));
  assert.equal(r.verdict, 'failed');
  assert.equal(r.failures[0].error.code, 'METHOD_NOT_FOUND');
  assert.match(r.failures[0].error.detail, /"steal_everything"/);
});

test('plain NEAR transfer', () => {
  const r = analyzeTx(fixture('near-transfer-ok'));
  assert.equal(r.verdict, 'success');
  assert.deepEqual(r.net['shop.test.near'], { NEAR: '250000000000000000000000' });
  assert.match(r.headline, /received 0\.25 NEAR/);
});

test('works without the receipts field (plain tx result, e.g. near-workspaces)', () => {
  const { receipts: _drop, ...plain } = fixture('vault-ft-transfer-unregistered-refund');
  const r = analyzeTx(plain);
  assert.equal(r.verdict, 'partial');
  assert.equal(r.failures[0].error.code, 'FT_NOT_REGISTERED');
});

test('formatReport renders tree, hint and funds', () => {
  const text = formatReport(analyzeTx(fixture('ft-transfer-call-uninitialized-receiver')));
  assert.match(text, /^PARTIAL: /);
  assert.match(text, /\[ERR\] ref-finance-101\.testnet  ft_on_transfer/);
  assert.match(text, /refund\s+1 wrap\.testnet {2}ref-finance-101\.testnet -> owner\.test\.near/);
  assert.doesNotMatch(text, /gas refund/);
});

test('fetchTx posts EXPERIMENTAL_tx_status and surfaces RPC errors', async () => {
  let sent: any;
  const ok = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ result: fixture('near-transfer-ok') }));
  }) as typeof fetch;
  const tx = await fetchTx({ hash: 'H', sender: 'owner.testnet', fetchImpl: ok });
  assert.equal(sent.method, 'EXPERIMENTAL_tx_status');
  assert.deepEqual(sent.params, { tx_hash: 'H', sender_account_id: 'owner.testnet', wait_until: 'FINAL' });
  assert.equal(tx.transaction.signer_id, 'owner.test.near');

  const bad = (async () => new Response(JSON.stringify({ error: { cause: { name: 'INVALID_ACCOUNT' }, message: 'bad id' } }))) as typeof fetch;
  await assert.rejects(fetchTx({ hash: 'H', sender: 'x.testnet', fetchImpl: bad }), /INVALID_ACCOUNT/);
});

test('fetchTx falls back to an archival node for old transactions', async () => {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    return url.includes('archival')
      ? new Response(JSON.stringify({ result: fixture('near-transfer-ok') }))
      : new Response(JSON.stringify({ error: { cause: { name: 'UNKNOWN_TRANSACTION' }, message: 'not found' } }));
  }) as typeof fetch;
  const tx = await fetchTx({ hash: 'H', sender: 'owner.testnet', fetchImpl: impl });
  assert.equal(tx.transaction.signer_id, 'owner.test.near');
  assert.deepEqual(urls.map((u) => u.includes('archival')), [false, true]);
});
