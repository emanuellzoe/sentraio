// Slow end-to-end checks against a local sandbox (run: pnpm test:sandbox).
//  1. An approval signed by Clearance is accepted by the real vault wasm, once.
//  2. The Simulator runs real testnet token code with real mirrored balances.
import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import nw from 'near-workspaces';
import { approve, base58Encode, guardianKey, useCurrentSandbox } from '../src/index.ts';
import type { Decision } from '../src/index.ts';
import { Simulator } from '../src/simulate.ts';

const WASM = new URL('../../../contracts/target/near/sentraio_vault/sentraio_vault.wasm', import.meta.url).pathname;
const N = (near: string) => BigInt(nw.parseNEAR(near));

test('Clearance approval is accepted by the vault contract exactly once', { timeout: 300_000 }, async () => {
  useCurrentSandbox();
  const worker = await nw.Worker.init();
  try {
    const { privateKey } = generateKeyPairSync('ed25519');
    const raw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    const secret = `ed25519:${base58Encode(Buffer.concat([raw, Buffer.alloc(32)]))}`;
    const { publicKey } = guardianKey(secret);

    const root = worker.rootAccount;
    const owner = await root.createSubAccount('owner', { initialBalance: N('20') });
    const agent = await owner.createSubAccount('agent', { initialBalance: N('5') });
    const shop = await root.createSubAccount('shop', { initialBalance: N('1') });
    const vault = await root.devDeploy(WASM, {
      initialBalance: N('10'),
      method: 'new',
      args: { owner_id: owner.accountId, guardian: { account_id: 'clearance.test.near', public_key: publicKey } },
    });
    await owner.call(vault, 'set_mandate', {
      agent_id: agent.accountId,
      mandate: { limits: [{ asset: 'NEAR', per_tx: N('1').toString(), per_day: N('2').toString() }], allowed_receivers: [shop.accountId], expires_at_ns: null, require_approval: true, max_strikes: 0 },
    }, { attachedDeposit: 1n });
    await owner.call(vault, 'deposit_near', {}, { attachedDeposit: N('3') });

    const action = { type: 'near_transfer' as const, receiver_id: shop.accountId, amount: N('0.5').toString() };
    const decision: Decision = { verdict: 'allow', request: { vaultId: vault.accountId, agentId: agent.accountId, action }, signals: [], summary: '', checkedAt: '' };
    const rpcUrl = (worker.provider as unknown as { connection: { url: string } }).connection.url;
    // the sandbox clock is real time, so sign against it
    const approval = await approve(decision, { guardianSecretKey: secret, rpcUrl });

    const before = BigInt((await shop.balance()).total.toString());
    const ok = await agent.callRaw(vault, 'execute', { action, approval }, { gas: 100_000_000_000_000n });
    assert.equal((ok.parseResult() as any).status, 'executed');
    assert.equal(BigInt((await shop.balance()).total.toString()) - before, N('0.5'));

    const replay = await agent.callRaw(vault, 'execute', { action, approval }, { gas: 100_000_000_000_000n });
    assert.equal((replay.parseResult() as any).reason, 'bad_signature');
  } finally {
    await worker.tearDown();
  }
});

test('Simulator: real wrap.testnet code + real balances', { timeout: 600_000 }, async () => {
  const sim = new Simulator({ network: 'testnet' });
  try {
    // real accounts holding/registered on wNEAR stand in for a vault and a shop
    const vaultId = 'exchange.ref-dev.testnet';
    const t0 = Date.now();
    const ok = await sim.run({ vaultId, agentId: 'agent.testnet', action: { type: 'ft_transfer', token: 'wrap.testnet', receiver_id: 'tx-bench.testnet', amount: N('1').toString(), memo: null } });
    const cold = Date.now() - t0;
    assert.equal(ok.coverage, 'full', JSON.stringify(ok.signals));
    assert.deepEqual(ok.signals.map((s) => s.level), ['ok']);
    assert.equal(ok.report?.net['tx-bench.testnet']?.['wrap.testnet'], N('1').toString());

    const t1 = Date.now();
    const call = await sim.run({ vaultId, agentId: 'agent.testnet', action: { type: 'ft_transfer_call', token: 'wrap.testnet', receiver_id: 'ref-finance-101.testnet', amount: N('1').toString(), msg: '' } });
    const warm = Date.now() - t1;
    assert.equal(call.coverage, 'partial');
    assert.ok(call.signals.some((s) => s.id === 'simulation_partial' && s.level === 'warn'));

    const t2 = Date.now();
    const again = await sim.run({ vaultId, agentId: 'agent.testnet', action: { type: 'ft_transfer', token: 'wrap.testnet', receiver_id: 'tx-bench.testnet', amount: N('2').toString(), memo: null } });
    const cached = Date.now() - t2;
    assert.equal(again.report?.net['tx-bench.testnet']?.['wrap.testnet'], N('2').toString(), 'balances re-mirrored, earlier run does not leak');
    console.log(`simulation timings: cold ${cold} ms, new receiver ${warm} ms, cached ${cached} ms`);
  } finally {
    await sim.stop();
  }
});
