// End-to-end check of the registry wasm in a local sandbox: warn -> blocked by
// distinct reporters, dispute, moderator dismiss slashes sybil deposits, real refunds.
import nw from 'near-workspaces';
const { Worker, parseNEAR } = nw;

const WASM = new URL('../../contracts/target/near/sentineli_registry/sentineli_registry.wasm', import.meta.url).pathname;
const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const DEPOSIT = parseNEAR('0.1');

const gasOf = (r) => [r.result.transaction_outcome, ...r.result.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
const GAS = [];
const meter = (label, r) => { GAS.push([label, gasOf(r)]); return r; };
const printGas = () => { console.log('\nGAS (all receipts, Tgas -> NEAR at 0.0001 NEAR/Tgas)'); for (const [l, g] of GAS) console.log(`  ${l.padEnd(34)} ${(Number(g) / 1e12).toFixed(2).padStart(6)} Tgas  ~${(Number(g) / 1e12 * 0.0001).toFixed(5)} NEAR`); };

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const owner = await root.createSubAccount('owner', { initialBalance: parseNEAR('5') });
  const mod = await root.createSubAccount('mod', { initialBalance: parseNEAR('5') });
  const target = await root.createSubAccount('drainer', { initialBalance: parseNEAR('5') });
  const reporters = await Promise.all(['r1', 'r2', 'r3'].map((n) => root.createSubAccount(n, { initialBalance: parseNEAR('5') })));

  const registry = await root.devDeploy(WASM, {
    initialBalance: parseNEAR('5'),
    method: 'new',
    args: { owner_id: owner.accountId, moderators: [mod.accountId], block_threshold: 3, report_deposit: DEPOSIT },
  });
  const status = async () => (await registry.view('get_status', { account_id: target.accountId })).status;
  const report = async (acc) => meter('report', await acc.callRaw(registry, 'report', {
    account_id: target.accountId, category: 'drainer', evidence_hash: HASH, evidence_url: 'https://example.com/e.json',
  }, { attachedDeposit: DEPOSIT }));

  check('starts clean', (await status()) === 'clean');
  await report(reporters[0]);
  check('1 reporter -> warn', (await status()) === 'warn');
  const short = await reporters[1].callRaw(registry, 'report', {
    account_id: target.accountId, category: 'drainer', evidence_hash: HASH, evidence_url: 'https://x',
  }, { attachedDeposit: '1' });
  check('report without deposit rejected', short.failed);
  await report(reporters[1]);
  await report(reporters[2]);
  check('3 distinct reporters -> suspected (not hard-blocked)', (await status()) === 'suspected');

  await target.call(registry, 'dispute', { note: 'sybil griefing, accounts created today' });
  check('dispute recorded', !!(await registry.view('get_status', { account_id: target.accountId })).dispute);

  meter('moderate_dismiss (3 reports)', await mod.callRaw(registry, 'moderate_dismiss', { account_id: target.accountId, reason: 'sybil reports' }));
  const params = await registry.view('get_params', {});
  check('dismiss -> clean + deposits slashed', (await status()) === 'clean' && params.slashed === (3n * BigInt(DEPOSIT)).toString());

  // honest report confirmed by moderator: deposit comes back
  const before = BigInt((await reporters[0].balance()).total.toString());
  await report(reporters[0]);
  await mod.call(registry, 'moderate_block', { account_id: target.accountId, reason: 'confirmed drainer' });
  const after = BigInt((await reporters[0].balance()).total.toString());
  const lost = before - after; // only gas should be lost, not the 0.1 NEAR deposit
  check('moderator block -> blocked', (await status()) === 'blocked');
  check('honest reporter deposit refunded', lost < BigInt(parseNEAR('0.01')), `(spent ${lost} yocto on gas)`);

  const batch = await registry.view('get_statuses', { account_ids: [target.accountId, owner.accountId] });
  check('batch lookup', batch[0][1] === 'blocked' && batch[1][1] === 'clean');
  printGas();
} finally {
  await worker.tearDown();
}
