// Runs the Clearance service against the testnet deployment and points the web app at it:
//   pnpm testnet:clearance     (Ctrl-C to stop), then: pnpm web
// Secrets come from ~/.countersign/testnet.json (guardian key, agent function-call key),
// created at deploy time and never stored in the repository.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { RPC_URLS, viewAccount } from '@countersign/core';
import { JsonFileStore, startClearanceServer } from '@countersign/clearance';

const DEPLOY = {
  vaultId: process.env.VAULT_ID ?? 'vault.countersign.testnet',
  registryId: process.env.REGISTRY_ID ?? 'registry.countersign.testnet',
  agentId: process.env.AGENT_ID ?? 'agent.countersign.testnet',
  knownAccounts: ['shop-payments.countersign.testnet'],
};
const secrets = JSON.parse(readFileSync(`${homedir()}/.countersign/testnet.json`, 'utf8')) as {
  guardianSecretKey: string;
  agentFcSecretKey: string;
};
const rpcUrl = RPC_URLS.testnet.regular;
const port = Number(process.env.CLEARANCE_PORT ?? 4010);

const vault = await viewAccount(DEPLOY.vaultId, { network: 'testnet' });
if (!vault) throw new Error(`${DEPLOY.vaultId} not found on testnet`);

const tokens = { agentToken: randomBytes(16).toString('hex'), operatorToken: randomBytes(16).toString('hex') };
const server = await startClearanceServer({
  ...tokens,
  port,
  network: 'testnet',
  guardianSecretKey: secrets.guardianSecretKey,
  registryId: DEPLOY.registryId,
  // the deployed code is the audited build: pin it so a redeploy is caught
  expectedVaultCodeHashes: [vault.code_hash],
  knownAccounts: DEPLOY.knownAccounts,
  store: new JsonFileStore(`${homedir()}/.countersign/clearance-store.json`),
});

const env = {
  NEXT_PUBLIC_NETWORK: 'testnet',
  NEXT_PUBLIC_RPC_URL: rpcUrl,
  NEXT_PUBLIC_VAULT_ID: DEPLOY.vaultId,
  NEXT_PUBLIC_REGISTRY_ID: DEPLOY.registryId,
  NEXT_PUBLIC_AGENT_ID: DEPLOY.agentId,
  NEXT_PUBLIC_VAULT_CODE_HASH: vault.code_hash,
  // server-only
  CLEARANCE_URL: server.url,
  CLEARANCE_OPERATOR_TOKEN: tokens.operatorToken,
  CLEARANCE_AGENT_TOKEN: tokens.agentToken,
  CLEARANCE_KNOWN_ACCOUNTS: DEPLOY.knownAccounts.join(','),
  // lets the dashboard play the agent; it is the function-call key (vault.execute only)
  DEV_AGENT_KEY: secrets.agentFcSecretKey,
};
writeFileSync(new URL('../../apps/web/.env.local', import.meta.url), `# written by pnpm testnet:clearance — testnet, regenerated on every start\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);

console.log(`clearance ${server.url} for ${DEPLOY.vaultId} (code ${vault.code_hash})`);
console.log('wrote apps/web/.env.local for testnet — (re)start the web app: pnpm web');
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
