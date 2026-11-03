import { EMPTY_CODE_HASH, viewAccount, viewFunction } from '@sentraio/core';
import type { ViewOptions } from '@sentraio/core';
import { findLookalike } from './lookalike.ts';
import type { Level, ClearanceConfig, ClearanceRequest, Signal, Store } from './types.ts';

export interface Ctx {
  cfg: ClearanceConfig;
  view: ViewOptions;
  store: Store;
  now: Date;
}

const sig = (id: string, level: Level, title: string, detail: string, source: string): Signal => ({ id, level, title, detail, source });
const IMPLICIT = /^[0-9a-f]{64}$/;
const DAY_MS = 86_400_000;

export interface VaultPreview {
  allowed: boolean;
  reason: string | null;
  requires_approval: boolean;
  nonce: number;
  spent_today: string;
}

interface Mandate {
  allowed_receivers: string[] | null;
  frozen: boolean;
}

/** The vault must run an audited build: a redeployed vault is the upgrade backdoor. */
export async function vaultIntegrity(ctx: Ctx, vaultId: string): Promise<Signal> {
  const acc = await viewAccount(vaultId, ctx.view);
  if (!acc) return sig('vault_code', 'block', 'Vault account not found', `${vaultId} does not exist.`, 'rpc');
  const pinned = ctx.cfg.expectedVaultCodeHashes ?? [];
  if (pinned.length === 0) {
    return sig('vault_code', 'warn', 'Vault code is not pinned', `Running ${acc.code_hash}; set expectedVaultCodeHashes so a redeployed vault is caught.`, 'rpc');
  }
  if (!pinned.includes(acc.code_hash)) {
    return sig('vault_code', 'block', 'Vault code does not match the audited build', `${vaultId} runs ${acc.code_hash}, expected one of ${pinned.join(', ')}.`, 'rpc');
  }
  return sig('vault_code', 'ok', 'Vault runs the audited build', acc.code_hash, 'rpc');
}

/** Ask the vault itself whether the mandate allows this action (limits, receivers, freeze). */
export async function vaultPolicy(ctx: Ctx, req: ClearanceRequest): Promise<{ signal: Signal; mandate?: Mandate; preview?: VaultPreview }> {
  const args = { agent_id: req.agentId, action: req.action };
  const [preview, mandate] = await Promise.all([
    viewFunction<VaultPreview>(req.vaultId, 'preview', args, ctx.view),
    viewFunction<Mandate | null>(req.vaultId, 'get_mandate', { agent_id: req.agentId }, ctx.view),
  ]);
  const signal = preview.allowed
    ? sig('vault_policy', 'ok', 'Within the agent mandate', `Spent today in this asset: ${preview.spent_today}.`, 'vault')
    : sig('vault_policy', 'block', 'Vault mandate would reject this', `Reason: ${preview.reason}.`, 'vault');
  return { signal, mandate: mandate ?? undefined, preview };
}

async function codeChange(ctx: Ctx, accountId: string, hash: string, role: string): Promise<Signal | undefined> {
  const last = await ctx.store.lastCodeHash(accountId);
  await ctx.store.saveCodeHash(accountId, hash);
  if (last && last.hash !== hash) {
    return sig(`${role}_code_changed`, 'warn', `${role === 'token' ? 'Token' : 'Receiver'} contract code changed`,
      `${accountId} was ${last.hash} when last seen (${last.seenAt}), now ${hash}. Re-check it before paying.`, 'local history');
  }
  return undefined;
}

export async function receiverAccount(ctx: Ctx, req: ClearanceRequest): Promise<Signal[]> {
  const id = req.action.receiver_id;
  const acc = await viewAccount(id, ctx.view);
  if (!acc) {
    if (IMPLICIT.test(id) && req.action.type === 'near_transfer') {
      return [sig('receiver_exists', 'warn', 'Implicit account not yet created', `${id} has never been funded; this transfer creates it.`, 'rpc')];
    }
    return [sig('receiver_exists', 'block', 'Receiver account does not exist', `${id} does not exist on this network (typo or look-alike?).`, 'rpc')];
  }
  const out = [sig('receiver_exists', 'ok', 'Receiver exists', id, 'rpc')];
  if (acc.code_hash !== EMPTY_CODE_HASH) {
    if (req.action.type === 'ft_transfer') {
      out.push(sig('receiver_is_contract', 'warn', 'Plain ft_transfer to a contract',
        `${id} is a contract and will not be notified of an ft_transfer; if this is a deposit, the tokens can get stuck. Use ft_transfer_call.`, 'rpc'));
    }
    const changed = await codeChange(ctx, id, acc.code_hash, 'receiver');
    if (changed) out.push(changed);
  }
  return out;
}

export async function tokenContract(ctx: Ctx, req: ClearanceRequest): Promise<Signal[]> {
  if (req.action.type === 'near_transfer') return [];
  const acc = await viewAccount(req.action.token, ctx.view);
  if (!acc || acc.code_hash === EMPTY_CODE_HASH) {
    return [sig('token_contract', 'block', 'Token contract missing', `${req.action.token} has no contract deployed.`, 'rpc')];
  }
  const changed = await codeChange(ctx, req.action.token, acc.code_hash, 'token');
  return changed ? [changed] : [];
}

const NEARBLOCKS: Record<string, string> = { testnet: 'https://api-testnet.nearblocks.io', mainnet: 'https://api.nearblocks.io' };

/** Age and activity from the NearBlocks indexer. Indexer lag means "no record" is not proof of anything. */
export async function receiverReputation(ctx: Ctx, receiverId: string): Promise<Signal[]> {
  if (ctx.cfg.nearblocksUrl === null) return [];
  const base = ctx.cfg.nearblocksUrl ?? NEARBLOCKS[ctx.view.network ?? 'testnet'];
  const get = async (path: string) => {
    const res = await (ctx.view.fetchImpl ?? fetch)(`${base}/v1/account/${receiverId}${path}`, {
      headers: { 'user-agent': 'sentraio-clearance' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`nearblocks HTTP ${res.status}`);
    return res.json() as Promise<any>;
  };
  try {
    const [info, count] = await Promise.all([get(''), get('/txns-only/count')]);
    const created = info?.account?.[0]?.created?.block_timestamp;
    if (!created) {
      return [sig('receiver_age', 'warn', 'No indexer history for receiver', `NearBlocks has no record of ${receiverId}: brand new, or the indexer is behind.`, 'nearblocks')];
    }
    const out: Signal[] = [];
    const ageDays = (ctx.now.getTime() - Number(created) / 1e6) / DAY_MS;
    const minDays = ctx.cfg.newAccountDays ?? 7;
    out.push(ageDays < minDays
      ? sig('receiver_age', 'warn', 'Receiver account is new', `Created ${ageDays.toFixed(1)} days ago (threshold ${minDays}).`, 'nearblocks')
      : sig('receiver_age', 'ok', 'Receiver account is established', `Created ${Math.floor(ageDays)} days ago.`, 'nearblocks'));
    const txs = Number(count?.txns?.[0]?.count ?? 0);
    const minTx = ctx.cfg.minTxCount ?? 5;
    out.push(txs < minTx
      ? sig('receiver_activity', 'warn', 'Receiver has little activity', `${txs} transactions (threshold ${minTx}).`, 'nearblocks')
      : sig('receiver_activity', 'ok', 'Receiver is active', `${txs} transactions.`, 'nearblocks'));
    return out;
  } catch (e) {
    return [sig('receiver_age', 'warn', 'Could not check receiver history', (e as Error).message, 'nearblocks')];
  }
}

export async function priorInteraction(ctx: Ctx, req: ClearanceRequest, mandate?: Mandate): Promise<Signal> {
  const id = req.action.receiver_id;
  if (mandate?.allowed_receivers?.includes(id)) {
    return sig('prior_interaction', 'ok', 'Receiver is on the owner allowlist', id, 'vault');
  }
  if ((await ctx.store.knownReceivers(req.vaultId)).has(id)) {
    return sig('prior_interaction', 'ok', 'Clearance approved payments to this receiver before', id, 'local history');
  }
  return sig('prior_interaction', 'warn', 'First payment to this receiver', `${req.vaultId} has never paid ${id}.`, 'local history');
}

type RegistryStatus = 'clean' | 'warn' | 'suspected' | 'blocked';

export async function registry(ctx: Ctx, req: ClearanceRequest): Promise<Signal[]> {
  if (!ctx.cfg.registryId) return [sig('registry', 'warn', 'No shared blocklist configured', 'Set registryId to check community reports.', 'registry')];
  const ids = [req.action.receiver_id, ...(req.action.type === 'near_transfer' ? [] : [req.action.token])];
  const rows = await viewFunction<[string, RegistryStatus][]>(ctx.cfg.registryId, 'get_statuses', { account_ids: ids }, ctx.view);
  return rows.map(([id, status]) => {
    const role = id === req.action.receiver_id ? 'receiver' : 'token';
    const Role = role === 'receiver' ? 'Receiver' : 'Token';
    if (status === 'blocked') return sig(`registry_${role}`, 'block', `${Role} is on the blocklist`, `${id} was confirmed malicious by a registry moderator.`, 'registry');
    if (status === 'suspected') return sig(`registry_${role}`, 'warn', `${Role} is widely reported`, `${id} has reports from several accounts (not yet confirmed). Review the evidence.`, 'registry');
    if (status === 'warn') return sig(`registry_${role}`, 'warn', `${Role} has a report`, `${id} has an unconfirmed report in the registry.`, 'registry');
    return sig(`registry_${role}`, 'ok', `${Role} has no reports`, id, 'registry');
  });
}

export async function lookalike(ctx: Ctx, req: ClearanceRequest, mandate?: Mandate): Promise<Signal> {
  const trusted = new Set([...(mandate?.allowed_receivers ?? []), ...(await ctx.store.knownReceivers(req.vaultId)), ...(ctx.cfg.knownAccounts ?? [])]);
  const twin = findLookalike(req.action.receiver_id, trusted);
  return twin
    ? sig('lookalike', 'block', 'Receiver imitates a trusted account', `${req.action.receiver_id} looks like ${twin} (address poisoning).`, 'local history')
    : sig('lookalike', 'ok', 'No look-alike of a trusted account', req.action.receiver_id, 'local history');
}
