// Chain config for server code. `local` = the `pnpm dev:chain` sandbox; owner actions are
// then signed server-side with a dev key. On testnet/mainnet they go through the wallet.
// Read through a dynamic key on purpose: Next inlines `process.env.NEXT_PUBLIC_X` at build
// time, which would pin the values of whatever sandbox existed when the app was built.
export type ChainMode = 'local' | 'testnet' | 'mainnet';

const env = (key: string) => process.env[key];

export const chain = {
  get mode() { return (env('NEXT_PUBLIC_NETWORK') ?? 'testnet') as ChainMode; },
  get rpcUrl() { return env('NEXT_PUBLIC_RPC_URL') ?? 'https://test.rpc.fastnear.com'; },
  get vaultId() { return env('NEXT_PUBLIC_VAULT_ID') ?? ''; },
  get registryId() { return env('NEXT_PUBLIC_REGISTRY_ID') ?? ''; },
  get ownerId() { return env('NEXT_PUBLIC_OWNER_ID') ?? ''; },
  get agentId() { return env('NEXT_PUBLIC_AGENT_ID') ?? ''; },
  get vaultCodeHash() { return env('NEXT_PUBLIC_VAULT_CODE_HASH') ?? ''; },
};

export const isLocalMode = () => chain.mode === 'local';
export const isConfigured = () => Boolean(chain.vaultId);
