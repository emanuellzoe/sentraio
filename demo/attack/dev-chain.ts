// Long-running local chain for frontend work until the testnet deploy:
//   pnpm dev:chain      (Ctrl-C to stop)
// Starts a sandbox, deploys vault + registry, creates owner/agent/vendors, runs the
// Preflight service, seeds some activity, and writes apps/web/.env.local.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Guard } from '@sentineli/guard';
import { base58Encode, MemoryStore, startPreflightServer, useCurrentSandbox } from '@sentineli/preflight';
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import nw from 'near-workspaces';

const here = (p: string) => new URL(p, import.meta.url).pathname;
const VAULT_WASM = here('../../contracts/target/near/sentineli_vault/sentineli_vault.wasm');
const REGISTRY_WASM = here('../../contracts/target/near/sentineli_registry/sentineli_registry.wasm');
const PREFLIGHT_PORT = Number(process.env.PREFLIGHT_PORT ?? 4010);
useCurrentSandbox();
if (!existsSync(VAULT_WASM) || !existsSync(REGISTRY_WASM)) {
  console.error('Contracts are not built yet. Run: pnpm build:contracts');
  process.exit(1);
}
const N = (s: string) => BigInt(nw.parseNEAR(s));

const worker = await nw.Worker.init();
const root = worker.rootAccount;
const rpcUrl = (worker.provider as unknown as { connection: { url: string } }).connection.url;
const provider = new JsonRpcProvider({ url: rpcUrl });
console.log(`sandbox ${rpcUrl}`);

const owner = await root.createSubAccount('owner', { initialBalance: N('100') });
const shop = await root.createSubAccount('shop-payments', { initialBalance: N('1') });
const attacker = await root.createSubAccount('shop-payrnents', { initialBalance: N('1') });
const coffee = await root.createSubAccount('coffee-corner', { initialBalance: N('1') });
const reporter = await root.createSubAccount('watchdog', { initialBalance: N('2') });
const agent = await owner.createSubAccount('agent', { initialBalance: N('2') });

const registry = await root.devDeploy(REGISTRY_WASM, {
  initialBalance: N('5'), method: 'new',
  args: { owner_id: owner.accountId, moderators: [owner.accountId], block_threshold: 3, report_deposit: N('0.1').toString() },
});
await reporter.call(registry, 'report', {
  account_id: attacker.accountId, category: 'impersonation',
  evidence_hash: createHash('sha256').update('fake invoice 1042').digest('hex'), evidence_url: 'https://example.com/evidence/1042.png',
}, { attachedDeposit: N('0.1') });

const guardian = KeyPair.fromRandom('ed25519');
const vault = await root.devDeploy(VAULT_WASM, {
  initialBalance: N('5'), method: 'new',
  args: { owner_id: owner.accountId, guardian: { account_id: 'preflight.test.near', public_key: guardian.getPublicKey().toString() } },
});
const vaultCodeHash = base58Encode(createHash('sha256').update(readFileSync(VAULT_WASM)).digest());
await owner.call(vault, 'set_mandate', {
  agent_id: agent.accountId,
  mandate: { limits: [{ asset: 'NEAR', per_tx: N('5').toString(), per_day: N('10').toString() }], allowed_receivers: null, expires_at_ns: null, require_approval: true, max_strikes: 3 },
}, { attachedDeposit: 1n });
await owner.call(vault, 'deposit_near', {}, { attachedDeposit: N('30') });

const agentFull = (await agent.getKey())!.toString() as KeyPairString;
const agentKey = KeyPair.fromRandom('ed25519');
await new Account(agent.accountId, provider, agentFull).addFunctionCallAccessKey({
  publicKey: agentKey.getPublicKey(), contractId: vault.accountId, methodNames: ['execute'], allowance: N('0.25'),
});

const store = new MemoryStore();
await store.rememberReceiver(vault.accountId, shop.accountId);
const tokens = { agentToken: randomBytes(16).toString('hex'), operatorToken: randomBytes(16).toString('hex') };
const server = await startPreflightServer({
  ...tokens, port: PREFLIGHT_PORT,
  guardianSecretKey: guardian.toString(),
  rpcUrl, nearblocksUrl: null, store,
  registryId: registry.accountId,
  expectedVaultCodeHashes: [vaultCodeHash],
  knownAccounts: [shop.accountId],
});

// ---- seed activity so every page has something to show
const guard = new Guard({ vaultId: vault.accountId, agentId: agent.accountId, agentKey: agentKey.toString() as KeyPairString, preflightUrl: server.url, agentToken: tokens.agentToken, rpcUrl });
const near = (to: string, amount: string) => ({ type: 'near_transfer' as const, receiver_id: to, amount: N(amount).toString() });
console.log('seed: honest payment', (await guard.pay(near(shop.accountId, '2'))).status);
console.log('seed: injected payment', (await guard.pay(near(attacker.accountId, '5'))).status);
await new Account(agent.accountId, provider, agentKey.toString() as KeyPairString).signAndSendTransaction({
  receiverId: vault.accountId, actions: [actions.functionCall('execute', { action: near(attacker.accountId, '5'), approval: null }, 100_000_000_000_000n, 0n)], waitUntil: 'FINAL', throwOnFailure: false,
});
console.log('seed: bypass attempt (vault strike)');
await fetch(`${server.url}/check`, {
  method: 'POST', headers: { authorization: `Bearer ${tokens.agentToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ vaultId: vault.accountId, agentId: agent.accountId, action: near(coffee.accountId, '1.5') }),
});
console.log('seed: new vendor payment waiting in the operator queue');

const env = {
  NEXT_PUBLIC_NETWORK: 'local',
  NEXT_PUBLIC_RPC_URL: rpcUrl,
  NEXT_PUBLIC_VAULT_ID: vault.accountId,
  NEXT_PUBLIC_REGISTRY_ID: registry.accountId,
  NEXT_PUBLIC_OWNER_ID: owner.accountId,
  NEXT_PUBLIC_AGENT_ID: agent.accountId,
  NEXT_PUBLIC_VAULT_CODE_HASH: vaultCodeHash,
  // server-only: never prefixed with NEXT_PUBLIC_
  PREFLIGHT_URL: server.url,
  PREFLIGHT_OPERATOR_TOKEN: tokens.operatorToken,
  PREFLIGHT_AGENT_TOKEN: tokens.agentToken,
  DEV_OWNER_KEY: (await owner.getKey())!.toString(),
  DEV_AGENT_FULL_KEY: agentFull,
  DEV_AGENT_KEY: agentKey.toString(),
};
writeFileSync(here('../../apps/web/.env.local'), `# written by pnpm dev:chain — local sandbox only, regenerated on every start\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
console.log(`\nready. preflight ${server.url}, vault ${vault.accountId}\nwrote apps/web/.env.local — start the web app with: pnpm --filter @sentineli/web dev\nCtrl-C to stop.`);

const stop = async () => {
  await server.close();
  await worker.tearDown();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
