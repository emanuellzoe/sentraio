// Records real EXPERIMENTAL_tx_status responses from a local sandbox as test
// fixtures for packages/core (the exact shape Tx X-Ray gets from a live RPC).
import nw from 'near-workspaces';
import { writeFileSync } from 'node:fs';
const { Worker, parseNEAR } = nw;

const WASM = new URL('../../contracts/target/near/sentraio_vault/sentraio_vault.wasm', import.meta.url).pathname;
const OUT = new URL('../../packages/core/test/fixtures/', import.meta.url).pathname;

const worker = await Worker.init();
async function save(name, r) {
  const { hash, signer_id } = r.result.transaction;
  const full = await worker.provider.sendJsonRpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer_id, wait_until: 'FINAL' });
  writeFileSync(`${OUT}${name}.json`, JSON.stringify(full, null, 2) + '\n');
  console.log(`saved ${name} (${full.receipts_outcome.length} receipts)`);
}

try {
  const root = worker.rootAccount;
  const owner = await root.createSubAccount('owner', { initialBalance: parseNEAR('50') });
  const agent = await owner.createSubAccount('agent', { initialBalance: parseNEAR('5') });
  const shop = await root.createSubAccount('shop', { initialBalance: parseNEAR('1') });
  const token = await root.importContract({ testnetContract: 'wrap.testnet' });
  await token.call(token, 'new', {});
  const ref = await root.importContract({ testnetContract: 'ref-finance-101.testnet' }); // code only: uninitialized
  const vault = await root.devDeploy(WASM, { initialBalance: parseNEAR('10'), method: 'new', args: { owner_id: owner.accountId, guardian: null } });

  for (const acc of [owner, shop, vault, ref]) {
    await acc.call(token, 'storage_deposit', { account_id: acc.accountId }, { attachedDeposit: parseNEAR('0.0125') });
  }
  await owner.call(token, 'near_deposit', {}, { attachedDeposit: parseNEAR('10') });
  await owner.call(vault, 'set_mandate', {
    agent_id: agent.accountId,
    mandate: { limits: [{ asset: token.accountId, per_tx: parseNEAR('2'), per_day: parseNEAR('5') }, { asset: 'NEAR', per_tx: parseNEAR('1'), per_day: parseNEAR('1') }],
               allowed_receivers: null, expires_at_ns: null, require_approval: false, max_strikes: 0 },
  }, { attachedDeposit: '1' });
  await owner.call(token, 'ft_transfer_call', { receiver_id: vault.accountId, amount: parseNEAR('5'), msg: '' }, { attachedDeposit: '1', gas: '100000000000000' });
  await owner.call(vault, 'deposit_near', {}, { attachedDeposit: parseNEAR('2') });

  const pay = (receiver_id, amount) => ({ action: { type: 'ft_transfer', token: token.accountId, receiver_id, amount, memo: null }, approval: null });
  const gas = { gas: '150000000000000' };

  await save('vault-ft-transfer-ok', await agent.callRaw(vault, 'execute', pay(shop.accountId, parseNEAR('1')), gas));
  await save('vault-rejected-over-limit', await agent.callRaw(vault, 'execute', pay(shop.accountId, parseNEAR('3')), gas));
  await save('vault-ft-transfer-unregistered-refund', await agent.callRaw(vault, 'execute', pay('ghost.test.near', parseNEAR('1')), gas));
  await save('vault-near-transfer-missing-account', await agent.callRaw(vault, 'execute',
    { action: { type: 'near_transfer', receiver_id: 'ghost.test.near', amount: parseNEAR('0.5') }, approval: null }, gas));
  await save('vault-out-of-gas', await agent.callRaw(vault, 'execute', pay(shop.accountId, parseNEAR('1')), { gas: '3000000000000' }));
  await save('ft-transfer-call-uninitialized-receiver', await owner.callRaw(token, 'ft_transfer_call',
    { receiver_id: ref.accountId, amount: parseNEAR('1'), msg: '' }, { attachedDeposit: '1', gas: '100000000000000' }));
  await save('method-not-found', await owner.callRaw(vault, 'steal_everything', {}, { gas: '5000000000000' }));
  await save('near-transfer-ok', await owner.batch(shop).transfer(parseNEAR('0.25')).transact());
} finally {
  await worker.tearDown();
}
