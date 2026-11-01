import { strict as assert } from 'node:assert';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import { test } from 'node:test';
import { approve, ApprovalRefused, base58Decode, base58Encode, findLookalike, guardianKey, MemoryStore, runPreflight, skeleton } from '../src/index.ts';
import type { AgentAction, PreflightConfig, PreflightRequest } from '../src/index.ts';
import { FakeChain } from './fake-chain.ts';

const VAULT = 'vault.owner.testnet';
const AGENT = 'agent.owner.testnet';
const TOKEN = 'usdc.testnet';
const SHOP = 'shop-payments.testnet';
const VAULT_HASH = 'VaultHash111';

const pay = (receiver = SHOP, amount = '100'): AgentAction => ({ type: 'ft_transfer', token: TOKEN, receiver_id: receiver, amount, memo: null });
const req = (action: AgentAction = pay()): PreflightRequest => ({ vaultId: VAULT, agentId: AGENT, action });

function chain(opts: { allowlist?: string[] | null; allowed?: boolean; registry?: Record<string, string> } = {}) {
  const c = new FakeChain()
    .account(VAULT, { code_hash: VAULT_HASH })
    .account(TOKEN, { code_hash: 'TokenHash1' })
    .account(SHOP)
    .account('registry.testnet', { code_hash: 'RegHash' })
    .view(VAULT, 'preview', () => ({ allowed: opts.allowed ?? true, reason: opts.allowed === false ? 'over_daily_limit' : null, requires_approval: true, nonce: 7, spent_today: '0' }))
    .view(VAULT, 'get_mandate', () => ({ allowed_receivers: opts.allowlist === undefined ? [SHOP] : opts.allowlist, frozen: false }))
    .view(VAULT, 'get_approval_message', (a) => `sentineli-approval:v1|msg-for|${a.agent_id}|${a.expires_at_ns}|${a.action.receiver_id}`)
    .view('registry.testnet', 'get_statuses', (a) => a.account_ids.map((id: string) => [id, opts.registry?.[id] ?? 'clean']));
  return c;
}

const cfg = (c: FakeChain, extra: Partial<PreflightConfig> = {}): PreflightConfig => ({
  expectedVaultCodeHashes: [VAULT_HASH],
  registryId: 'registry.testnet',
  fetchImpl: c.fetch,
  now: () => c.now,
  ...extra,
});

const ids = (d: { signals: { id: string; level: string }[] }, level: string) => d.signals.filter((s) => s.level === level).map((s) => s.id);

test('known, established, allowlisted receiver -> allow', async () => {
  const c = chain();
  const d = await runPreflight(req(), cfg(c));
  assert.equal(d.verdict, 'allow', JSON.stringify(d.signals, null, 1));
  assert.equal(d.summary, 'All checks passed.');
});

test('redeployed vault (code hash mismatch) -> block', async () => {
  const c = chain().account(VAULT, { code_hash: 'EvilHash' });
  const d = await runPreflight(req(), cfg(c));
  assert.equal(d.verdict, 'block');
  assert.ok(ids(d, 'block').includes('vault_code'));
});

test('mandate rejection -> block, and simulation is skipped', async () => {
  const c = chain({ allowed: false });
  let simulated = false;
  const d = await runPreflight(req(), cfg(c, { simulate: async () => ((simulated = true), { coverage: 'full', signals: [], durationMs: 0 }) }));
  assert.equal(d.verdict, 'block');
  assert.match(d.summary, /Vault mandate would reject this/);
  assert.equal(simulated, false);
});

test('receiver that does not exist -> block', async () => {
  const d = await runPreflight(req(pay('shop-paymnts.testnet')), cfg(chain({ allowlist: null })));
  assert.equal(d.verdict, 'block');
  assert.ok(ids(d, 'block').includes('receiver_exists'));
});

test('look-alike of an allowlisted receiver -> block (address poisoning)', async () => {
  const fake = 'shop-payrnents.testnet'; // "rn" reads as "m"
  const c = chain().account(fake);
  const d = await runPreflight(req(pay(fake)), cfg(c));
  assert.equal(d.verdict, 'block');
  const s = d.signals.find((x) => x.id === 'lookalike')!;
  assert.match(s.detail, /looks like shop-payments\.testnet/);
});

test('new, quiet, never-paid receiver -> warn (ask a human)', async () => {
  const c = chain({ allowlist: null }).account('fresh.testnet', { ageDays: 1, txCount: 2 });
  const d = await runPreflight(req(pay('fresh.testnet')), cfg(c));
  assert.equal(d.verdict, 'warn');
  assert.deepEqual(ids(d, 'warn').sort(), ['prior_interaction', 'receiver_activity', 'receiver_age']);
  assert.match(d.summary, /^Needs a human: /);
});

test('registry: suspected -> warn, moderator-blocked -> block', async () => {
  const sus = await runPreflight(req(), cfg(chain({ registry: { [SHOP]: 'suspected' } })));
  assert.equal(sus.verdict, 'warn');
  const blk = await runPreflight(req(), cfg(chain({ registry: { [TOKEN]: 'blocked' } })));
  assert.equal(blk.verdict, 'block');
  assert.ok(ids(blk, 'block').includes('registry_token'));
});

test('receiver contract code change since last run -> warn', async () => {
  const store = new MemoryStore();
  const action = { type: 'ft_transfer_call', token: TOKEN, receiver_id: 'dex.testnet', amount: '5', msg: '' } as const;
  const c1 = chain({ allowlist: ['dex.testnet'] }).account('dex.testnet', { code_hash: 'DexV1' });
  assert.equal((await runPreflight(req(action), cfg(c1, { store }))).verdict, 'allow');
  const c2 = chain({ allowlist: ['dex.testnet'] }).account('dex.testnet', { code_hash: 'DexV2' });
  const d = await runPreflight(req(action), cfg(c2, { store }));
  assert.equal(d.verdict, 'warn');
  assert.ok(ids(d, 'warn').includes('receiver_code_changed'));
});

test('plain ft_transfer to a contract -> warn (tokens can get stuck)', async () => {
  const c = chain({ allowlist: ['dex.testnet'] }).account('dex.testnet', { code_hash: 'DexV1' });
  const d = await runPreflight(req(pay('dex.testnet')), cfg(c));
  assert.ok(ids(d, 'warn').includes('receiver_is_contract'));
});

test('indexer outage degrades to warn, never to a silent pass or a crash', async () => {
  const c = chain();
  c.nearblocksDown = true;
  const d = await runPreflight(req(), cfg(c));
  assert.equal(d.verdict, 'warn');
  assert.ok(ids(d, 'warn').includes('receiver_age'));
});

test('a failing simulation becomes a warn', async () => {
  const d = await runPreflight(req(), cfg(chain(), { simulate: async () => { throw new Error('sandbox died'); } }));
  assert.equal(d.verdict, 'warn');
  assert.equal(d.simulation?.coverage, 'skipped');
});

// --- approvals ---------------------------------------------------------------

function nearKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { secret: `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`, publicKey: `ed25519:${base58Encode(pub)}`, nodePublic: publicKey };
}

test('NEAR secret key round-trips to the right public key', () => {
  const kp = nearKeyPair();
  assert.equal(guardianKey(kp.secret).publicKey, kp.publicKey);
  assert.deepEqual(base58Decode(base58Encode(Buffer.from([0, 0, 1, 2]))), Buffer.from([0, 0, 1, 2]));
});

test('approve: block refuses, warn needs a human, signature verifies over the vault message', async () => {
  const kp = nearKeyPair();
  const c = chain({ allowlist: null }).account('fresh.testnet', { ageDays: 1, txCount: 2 });
  const opts = { guardianSecretKey: kp.secret, fetchImpl: c.fetch, now: () => 1_000 };

  const blocked = await runPreflight(req(pay('nope.testnet')), cfg(c));
  await assert.rejects(approve(blocked, opts), ApprovalRefused);

  const warned = await runPreflight(req(pay('fresh.testnet')), cfg(c));
  await assert.rejects(approve(warned, opts), /needs human confirmation/);

  const a = await approve(warned, { ...opts, humanConfirmedBy: 'owner.testnet' });
  assert.equal(a.expires_at_ns, String((1_000n + 60_000n) * 1_000_000n));
  const msg = `sentineli-approval:v1|msg-for|${AGENT}|${a.expires_at_ns}|fresh.testnet`;
  assert.ok(verify(null, Buffer.from(msg), kp.nodePublic, Buffer.from(a.signature, 'base64')));
  assert.ok(c.calls.includes(`${VAULT}.get_approval_message`), 'message comes from the vault, not re-encoded locally');
});

// --- look-alike detection ------------------------------------------------------

test('look-alikes', () => {
  const trusted = ['shop-payments.testnet', 'a1b2c3d4' + '0'.repeat(48) + 'e5f6a7b8'];
  assert.equal(findLookalike('shop-payments.testnet', trusted), undefined, 'exact match is fine');
  assert.equal(findLookalike('shop-paymants.testnet', trusted), 'shop-payments.testnet');
  assert.equal(findLookalike('shop_payments.testnet', trusted), 'shop-payments.testnet');
  assert.equal(findLookalike('shop-pаyments.testnet', trusted), 'shop-payments.testnet', 'cyrillic а');
  assert.equal(findLookalike('a1b2c3d4' + 'f'.repeat(48) + 'e5f6a7b8', trusted), trusted[1], 'implicit poisoning');
  assert.equal(findLookalike('coffee.testnet', trusted), undefined);
  assert.equal(skeleton('Sh0p-PayMents'), 'shoppayments');
});
