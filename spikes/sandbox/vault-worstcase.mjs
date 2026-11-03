// Worst-case gas for the vault's bounded loops:
//  - trigger_panic with the maximum 10 tokens + NEAR in the vault
//  - execute with the maximum 10 asset limits and 50 allowed receivers
import nw from 'near-workspaces';
const { Worker, parseNEAR } = nw;

const WASM = new URL('../../contracts/target/near/sentraio_vault/sentraio_vault.wasm', import.meta.url).pathname;
const gasOf = (r) => [r.result.transaction_outcome, ...r.result.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
const tgas = (g) => (Number(g) / 1e12).toFixed(2);

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const owner = await root.createSubAccount('owner', { initialBalance: parseNEAR('100') });
  const agent = await owner.createSubAccount('agent', { initialBalance: parseNEAR('5') });
  const shop = await root.createSubAccount('shop', { initialBalance: parseNEAR('1') });
  const vault = await root.devDeploy(WASM, { initialBalance: parseNEAR('20'), method: 'new', args: { owner_id: owner.accountId, guardian: null } });

  // 10 independent copies of the real wNEAR contract
  const wrap = await root.importContract({ testnetContract: 'wrap.testnet' });
  const code = Buffer.from(await worker.provider.viewCodeRaw(wrap.accountId), 'base64');
  const tokens = [];
  for (let i = 0; i < 10; i++) {
    const t = await root.createSubAccount(`tok${i}`, { initialBalance: parseNEAR('5') });
    await t.deploy(code);
    await t.call(t, 'new', {});
    for (const acc of [owner, vault, shop]) {
      await acc.call(t, 'storage_deposit', { account_id: acc.accountId }, { attachedDeposit: parseNEAR('0.0125') });
    }
    await owner.call(t, 'near_deposit', {}, { attachedDeposit: parseNEAR('2') });
    tokens.push(t);
  }

  const receivers = [shop.accountId, ...Array.from({ length: 49 }, (_, i) => `r${i}.test.near`)];
  const limits = tokens.map((t) => ({ asset: t.accountId, per_tx: parseNEAR('1'), per_day: parseNEAR('1') }));
  await owner.call(vault, 'set_mandate', {
    agent_id: agent.accountId,
    mandate: { limits, allowed_receivers: receivers, expires_at_ns: null, require_approval: false, max_strikes: 0 },
  }, { attachedDeposit: '1' });
  for (const t of tokens) {
    await owner.call(t, 'ft_transfer_call', { receiver_id: vault.accountId, amount: parseNEAR('1'), msg: '' }, { attachedDeposit: '1', gas: '100000000000000' });
  }
  await owner.call(vault, 'deposit_near', {}, { attachedDeposit: parseNEAR('1') });

  // execute: worst case = last token in the limit list, last receiver in the allowlist
  const last = tokens.at(-1);
  await last.call(last, 'storage_deposit', { account_id: receivers.at(-1) }, { attachedDeposit: parseNEAR('0.0125') }).catch(() => {});
  const ex = await agent.callRaw(vault, 'execute', {
    action: { type: 'ft_transfer', token: last.accountId, receiver_id: shop.accountId, amount: parseNEAR('0.5'), memo: null },
    approval: null,
  }, { gas: '150000000000000' });
  console.log(`execute (10 limits, 50 receivers): ${tgas(gasOf(ex))} Tgas  ok=${ex.succeeded}`);

  // tok9: owner unregisters, so the drain transfer for it must fail and be re-credited
  await owner.call(tokens[9], 'storage_unregister', { force: true }, { attachedDeposit: '1' });
  const ownerBefore = await Promise.all(tokens.map(async (t) => (await t.view('ft_balance_of', { account_id: owner.accountId })) ?? '0'));
  const p = await owner.callRaw(vault, 'trigger_panic', {}, { attachedDeposit: '1', gas: '200000000000000' });
  const ownerAfter = await Promise.all(tokens.map(async (t) => (await t.view('ft_balance_of', { account_id: owner.accountId })) ?? '0'));
  const returned = ownerAfter.filter((a, i) => BigInt(a) > BigInt(ownerBefore[i])).length;
  console.log(`trigger_panic (10 tokens + NEAR, 200 Tgas attached): ${tgas(gasOf(p))} Tgas burnt  ok=${p.succeeded}  tokens returned=${returned}/10`);
  if (!p.succeeded) console.log(JSON.stringify(p.receiptFailureMessages ?? p.errors).slice(0, 400));
  console.log('vault balances after:', JSON.stringify(await vault.view('get_balances', {})));
} finally {
  await worker.tearDown();
}
