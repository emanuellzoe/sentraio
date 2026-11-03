// Throwaway spike: can Clearance fork a real testnet token into a local sandbox,
// run an ft_transfer, and read balance deltas + receipt outcomes fast enough?
import nw from 'near-workspaces';
const { Worker, parseNEAR } = nw;

const TOKEN = process.env.TOKEN ?? 'wrap.testnet';
const t0 = Date.now();
const lap = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

const worker = await Worker.init();
lap('sandbox up');

try {
  const root = worker.rootAccount;

  // 1) Try importing code + state; real token state is usually too big, so fall back to code only.
  let token;
  try {
    token = await root.importContract({ testnetContract: TOKEN, withData: true });
    lap(`imported ${TOKEN} WITH state`);
  } catch (e) {
    lap(`import with state failed: ${String(e.message ?? e).slice(0, 160)}`);
    token = await root.importContract({ testnetContract: TOKEN });
    await token.call(token, 'new', {});
    lap(`imported ${TOKEN} code only + init`);
  }

  const agent = await root.createSubAccount('agent', { initialBalance: parseNEAR('10') });
  const victim = await root.createSubAccount('victim', { initialBalance: parseNEAR('1') });

  for (const acc of [agent, victim]) {
    await acc.call(token, 'storage_deposit', {}, { attachedDeposit: parseNEAR('0.0125') });
  }
  await agent.call(token, 'near_deposit', {}, { attachedDeposit: parseNEAR('2') });
  lap('accounts funded');

  const bal = async (acc) => BigInt(await token.view('ft_balance_of', { account_id: acc.accountId }));
  const before = { agent: await bal(agent), victim: await bal(victim) };

  // 2) The simulated action: what Clearance would run before letting the agent sign for real.
  const amount = parseNEAR('1.5');
  const result = await agent.callRaw(token, 'ft_transfer', { receiver_id: victim.accountId, amount }, { attachedDeposit: '1' });
  lap('simulated ft_transfer');

  const after = { agent: await bal(agent), victim: await bal(victim) };
  console.log('delta agent ', (after.agent - before.agent).toString());
  console.log('delta victim', (after.victim - before.victim).toString());
  console.log('succeeded   ', result.succeeded);
  console.log('receipts    ', result.receipts_outcomes.map((r) => ({
    executor: r.outcome.executor_id,
    status: Object.keys(r.outcome.status)[0],
    gas_tgas: (r.outcome.gas_burnt / 1e12).toFixed(2),
    logs: r.outcome.logs,
  })));

  // 3) A failing action, to confirm we can surface failed receipts (Tx X-Ray input).
  const bad = await agent.callRaw(token, 'ft_transfer', { receiver_id: 'nobody.test.near', amount }, { attachedDeposit: '1' });
  lap('simulated failing ft_transfer');
  console.log('failed ok   ', bad.failed, JSON.stringify(bad.receiptFailureMessages ?? bad.errors ?? []).slice(0, 300));
} finally {
  await worker.tearDown();
  lap('teardown');
}
