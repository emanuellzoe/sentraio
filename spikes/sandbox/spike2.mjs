// Spike 2:
//  (1) mirror REAL testnet balances into the sandbox without reading remote state
//      (public RPCs refuse view_state on big contracts, even for a single key):
//      learn the storage key layout locally with a probe account, then write the
//      real value fetched via the ft_balance_of view method.
//  (2) ft_transfer_call to a second contract: pre-import the receiver, then scan
//      receipts so a missing/uninitialized contract becomes "partial simulation"
//      instead of a fake pass or fake failure.
import nw from 'near-workspaces';
const { Worker, parseNEAR } = nw;

const RPC = 'https://rpc.testnet.near.org';
const TOKEN = 'wrap.testnet';
const SENDER = 'exchange.ref-dev.testnet'; // real wNEAR holder on testnet
const RECEIVER = 'ref-finance-101.testnet'; // real DEX with ft_on_transfer
const t0 = Date.now();
const lap = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

async function remoteView(contract, method, args) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: {
        request_type: 'call_function', finality: 'final', account_id: contract,
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  }).then((r) => r.json());
  if (res.error) throw new Error(JSON.stringify(res.error.cause ?? res.error));
  return JSON.parse(Buffer.from(res.result.result).toString());
}

const u128le = (n) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(n & 0xffffffffffffffffn); b.writeBigUInt64LE(n >> 64n, 8); return b; };

// Like importContract(code only), but resets storage_usage: the copied value reflects the
// remote contract's full state and makes even the local node refuse view_state.
async function importCode(root, id, initialBalance) {
  const rpc = nw.JsonRpcProvider.fromNetwork('testnet');
  const view = await rpc.viewAccount(id);
  const account = root.getAccount(id);
  const pubKey = await account.setKey();
  const hasCode = view.code_hash !== nw.EMPTY_CONTRACT_HASH;
  const code = hasCode ? await rpc.viewCodeRaw(id) : undefined;
  const size = hasCode ? Buffer.from(code, 'base64').length : 0;
  const records = account.recordBuilder()
    .account({ ...view, amount: initialBalance ?? view.amount, storage_usage: size + 1000 })
    .accessKey(pubKey);
  if (hasCode) records.contract(code);
  await account.patchStateRecords(records);
  return account;
}

const worker = await Worker.init();
lap('sandbox up');
try {
  const root = worker.rootAccount;
  const token = await importCode(root, TOKEN, parseNEAR('100'));
  await token.call(token, 'new', {});
  lap(`imported ${TOKEN} (code only)`);

  // --- (1) learn where balances live, using a probe account with a known balance
  const probe = await root.createSubAccount('probe', { initialBalance: parseNEAR('5') });
  const before = new Set((await worker.provider.viewStateRaw(TOKEN, '')).map((kv) => kv.key));
  await probe.call(token, 'storage_deposit', {}, { attachedDeposit: parseNEAR('0.0125') });
  const marker = 123456789n;
  await probe.call(token, 'near_deposit', {}, { attachedDeposit: marker.toString() });
  const fresh = (await worker.provider.viewStateRaw(TOKEN, '')).filter((kv) => !before.has(kv.key));
  const idBytes = Buffer.from(probe.accountId);
  const hit = fresh.find((kv) => Buffer.from(kv.key, 'base64').includes(idBytes) && Buffer.from(kv.value, 'base64').equals(u128le(marker)));
  if (!hit) throw new Error('could not learn balance layout');
  const probeKey = Buffer.from(hit.key, 'base64');
  const at = probeKey.indexOf(idBytes);
  const prefix = probeKey.subarray(0, at - 4); // borsh string = u32 len + bytes
  const keyFor = (id) => { const len = Buffer.alloc(4); len.writeUInt32LE(id.length); return Buffer.concat([prefix, len, Buffer.from(id)]); };
  lap(`learned layout: prefix=${JSON.stringify(prefix.toString())} + borsh(account_id) -> u128`);

  // import sender + receiver as accounts we can sign for, then mirror their real balances
  const sender = await importCode(root, SENDER, parseNEAR('20'));
  await importCode(root, RECEIVER, parseNEAR('20'));
  lap('imported sender + receiver (code only)');

  for (const id of [SENDER, RECEIVER]) {
    const real = BigInt(await remoteView(TOKEN, 'ft_balance_of', { account_id: id }));
    await token.patchStateRecords({ records: [{ Data: { account_id: TOKEN, data_key: keyFor(id).toString('base64'), value: u128le(real).toString('base64') } }] });
    const mirrored = BigInt(await token.view('ft_balance_of', { account_id: id }));
    console.log(`  ${id}: real=${real} sandbox=${mirrored} ${real === mirrored ? 'MATCH' : 'MISMATCH'}`);
  }
  // total_supply lives inside the root STATE struct; locally it equals the probe's deposit,
  // so find those 16 bytes and swap in the real supply (otherwise withdraw underflows).
  const stateKey = Buffer.from('STATE').toString('base64');
  const stateKv = (await worker.provider.viewStateRaw(TOKEN, '')).find((kv) => kv.key === stateKey);
  const stateVal = Buffer.from(stateKv.value, 'base64');
  const at2 = stateVal.indexOf(u128le(marker));
  if (at2 < 0) throw new Error('could not find total_supply in STATE');
  const realSupply = BigInt(await remoteView(TOKEN, 'ft_total_supply', {}));
  u128le(realSupply).copy(stateVal, at2);
  await token.patchStateRecords({ records: [{ Data: { account_id: TOKEN, data_key: stateKey, value: stateVal.toString('base64') } }] });
  console.log(`  total_supply: real=${realSupply} sandbox=${await token.view('ft_total_supply', {})}`);
  lap('mirrored real balances + total supply');

  // --- (2) ft_transfer_call into a contract whose own state we could not copy
  const amount = parseNEAR('1');
  const res = await sender.callRaw(token, 'ft_transfer_call', { receiver_id: RECEIVER, amount, msg: '' }, { attachedDeposit: '1', gas: '300000000000000' });
  lap('simulated ft_transfer_call');

  const receipts = res.receipts_outcomes.map((r) => ({
    executor: r.outcome.executor_id,
    status: Object.keys(r.outcome.status)[0],
    failure: r.outcome.status.Failure ? JSON.stringify(r.outcome.status.Failure).slice(0, 200) : undefined,
    logs: r.outcome.logs,
  }));
  console.log(receipts);

  const notInitialized = receipts.some((r) => /not initialized|does not exist|CodeDoesNotExist|AccountDoesNotExist/i.test(r.failure ?? ''));
  const anyFailure = receipts.some((r) => r.failure);
  const verdict = notInitialized ? 'PARTIAL -> warn: downstream contract state could not be reproduced'
    : anyFailure ? 'FAILED in simulation -> block/explain'
    : 'FULL simulation passed';
  console.log('verdict:', verdict);
  console.log('sender balance after:', await token.view('ft_balance_of', { account_id: SENDER }));
} finally {
  await worker.tearDown();
  lap('teardown');
}
