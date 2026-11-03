// End-to-end check of the vault wasm against the real wrap.testnet code in a local sandbox:
// limits, approval signatures, failed-transfer refund, and panic drain.
import nw from 'near-workspaces';
const { Worker, parseNEAR, KeyPairEd25519 } = nw;

const WASM = new URL('../../contracts/target/near/countersign_vault/countersign_vault.wasm', import.meta.url).pathname;
const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
const ret = (r) => { try { return r.parseResult(); } catch { return null; } };

const gasOf = (r) => [r.result.transaction_outcome, ...r.result.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
const GAS = [];
const meter = (label, r) => { GAS.push([label, gasOf(r)]); return r; };
const printGas = () => { console.log('\nGAS (all receipts, Tgas -> NEAR at 0.0001 NEAR/Tgas)'); for (const [l, g] of GAS) console.log(`  ${l.padEnd(34)} ${(Number(g) / 1e12).toFixed(2).padStart(6)} Tgas  ~${(Number(g) / 1e12 * 0.0001).toFixed(5)} NEAR`); };

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const owner = await root.createSubAccount('owner', { initialBalance: parseNEAR('50') });
  const agent = await owner.createSubAccount('agent', { initialBalance: parseNEAR('5') });
  const shop = await root.createSubAccount('shop', { initialBalance: parseNEAR('1') });
  const guardianKey = KeyPairEd25519.fromRandom();
  const guardian = await root.createSubAccount('clearance', { initialBalance: parseNEAR('1') });

  const token = await root.importContract({ testnetContract: 'wrap.testnet' });
  await token.call(token, 'new', {});

  const vault = await root.devDeploy(WASM, {
    initialBalance: parseNEAR('10'),
    method: 'new',
    args: { owner_id: owner.accountId, guardian: { account_id: guardian.accountId, public_key: guardianKey.getPublicKey().toString() } },
  });

  for (const acc of [owner, shop, vault]) {
    await acc.call(token, 'storage_deposit', { account_id: acc.accountId }, { attachedDeposit: parseNEAR('0.0125') });
  }
  await owner.call(token, 'near_deposit', {}, { attachedDeposit: parseNEAR('20') });

  const limits = [{ asset: token.accountId, per_tx: parseNEAR('2'), per_day: parseNEAR('5') }];
  const setMandate = (require_approval) => owner.call(vault, 'set_mandate', {
    agent_id: agent.accountId,
    mandate: { limits, allowed_receivers: [shop.accountId], expires_at_ns: null, require_approval, max_strikes: 3 },
  }, { attachedDeposit: '1' });
  await setMandate(false);
  await owner.call(token, 'ft_transfer_call', { receiver_id: vault.accountId, amount: parseNEAR('10'), msg: '' }, { attachedDeposit: '1', gas: '100000000000000' });
  check('vault funded', (await vault.view('get_balance', { asset: token.accountId })) === parseNEAR('10'));

  const pay = (amount, receiver = shop.accountId) => ({ type: 'ft_transfer', token: token.accountId, receiver_id: receiver, amount, memo: null });
  const exec = (action, approval = null) => agent.callRaw(vault, 'execute', { action, approval }, { gas: '150000000000000' });

  let r = meter('execute ft_transfer (ok)', await exec(pay(parseNEAR('1.5'))));
  check('within limit -> executed', ret(r)?.status === 'executed', JSON.stringify(ret(r)));
  check('shop received', (await token.view('ft_balance_of', { account_id: shop.accountId })) === parseNEAR('1.5'));

  r = meter('execute rejected (over limit)', await exec(pay(parseNEAR('3'))));
  check('over per_tx -> rejected', ret(r)?.reason === 'over_per_tx_limit');

  r = await exec(pay(parseNEAR('1'), 'attacker.test.near'));
  check('unlisted receiver -> rejected', ret(r)?.reason === 'receiver_not_allowed');

  // receiver allowed by mandate but not registered on the token -> ft_transfer fails -> refund
  await owner.call(vault, 'set_mandate', {
    agent_id: agent.accountId,
    mandate: { limits, allowed_receivers: null, expires_at_ns: null, require_approval: false, max_strikes: 3 },
  }, { attachedDeposit: '1' });
  const before = await vault.view('get_balance', { asset: token.accountId });
  r = await exec(pay(parseNEAR('1'), 'unregistered.test.near'));
  const after = await vault.view('get_balance', { asset: token.accountId });
  check('failed transfer -> ledger refunded', ret(r)?.status === 'failed' && before === after, JSON.stringify(ret(r)));

  // approval-gated
  await setMandate(true);
  r = await exec(pay(parseNEAR('1')));
  check('approval required -> rejected without it', ret(r)?.reason === 'approval_missing');
  check('3rd rejection -> auto-frozen', (await vault.view('get_mandate', { agent_id: agent.accountId })).frozen === true);
  r = await exec(pay(parseNEAR('1')));
  check('frozen agent -> rejected', ret(r)?.reason === 'agent_frozen');
  await owner.call(vault, 'unfreeze', { agent_id: agent.accountId }, { attachedDeposit: '1' });

  const expires = String(BigInt(Date.now()) * 1_000_000n + 120_000_000_000n);
  const action = pay(parseNEAR('1'));
  const msg = await vault.view('get_approval_message', { agent_id: agent.accountId, action, expires_at_ns: expires });
  const sig = guardianKey.sign(Buffer.from(msg)).signature;
  const approval = { signature: Buffer.from(sig).toString('base64'), expires_at_ns: expires };
  r = meter('execute with approval signature', await exec(action, approval));
  check('valid Clearance approval -> executed', ret(r)?.status === 'executed', JSON.stringify(ret(r)));
  r = await exec(action, approval);
  check('replayed approval -> rejected', ret(r)?.reason === 'bad_signature');

  // panic by guardian: drain to owner
  const ownerBefore = BigInt(await token.view('ft_balance_of', { account_id: owner.accountId }));
  const vaultBal = BigInt(await vault.view('get_balance', { asset: token.accountId }));
  meter('trigger_panic (drain 1 asset)', await guardian.callRaw(vault, 'trigger_panic', {}, { gas: '300000000000000' }));
  const ownerAfter = BigInt(await token.view('ft_balance_of', { account_id: owner.accountId }));
  check('panic -> balance returned to owner', ownerAfter - ownerBefore === vaultBal, `(${vaultBal})`);
  r = await exec(pay(parseNEAR('1')));
  check('after panic -> rejected', ret(r)?.reason === 'vault_panicked');

  // rescue: tokens sent with a plain ft_transfer are invisible to the ledger until synced
  await owner.call(token, 'ft_transfer', { receiver_id: vault.accountId, amount: parseNEAR('2') }, { attachedDeposit: '1' });
  check('plain ft_transfer is untracked', (await vault.view('get_balance', { asset: token.accountId })) === '0');
  meter('sync_balance', await owner.callRaw(vault, 'sync_balance', { token: token.accountId }, { attachedDeposit: '1', gas: '50000000000000' }));
  check('sync_balance recovers it', (await vault.view('get_balance', { asset: token.accountId })) === parseNEAR('2'));
  const ob = BigInt(await token.view('ft_balance_of', { account_id: owner.accountId }));
  await owner.call(vault, 'withdraw', { asset: token.accountId, amount: parseNEAR('2') }, { attachedDeposit: '1', gas: '50000000000000' });
  check('owner withdraws recovered funds', BigInt(await token.view('ft_balance_of', { account_id: owner.accountId })) - ob === BigInt(parseNEAR('2')));

  printGas();
} finally {
  await worker.tearDown();
}
