import type { Network, TxReport } from '@sentraio/core';

/** Mirrors the vault's `AgentAction` JSON. */
export type AgentAction =
  | { type: 'ft_transfer'; token: string; receiver_id: string; amount: string; memo?: string | null }
  | { type: 'ft_transfer_call'; token: string; receiver_id: string; amount: string; msg: string }
  | { type: 'near_transfer'; receiver_id: string; amount: string };

export interface ClearanceRequest {
  vaultId: string;
  agentId: string;
  action: AgentAction;
}

export type Level = 'ok' | 'warn' | 'block';

export interface Signal {
  id: string;
  level: Level;
  title: string;
  detail: string;
  /** Where the evidence came from (rpc, nearblocks, registry, sandbox, local history). */
  source: string;
}

export interface SimulationResult {
  /** `full`: every receipt ran against reproduced state; `partial`: some contract could not be reproduced. */
  coverage: 'full' | 'partial' | 'skipped';
  report?: TxReport;
  signals: Signal[];
  durationMs: number;
}

/** Track wording: allow = sign, warn = ask a human, block = refuse. */
export type Verdict = 'allow' | 'warn' | 'block';

export interface Decision {
  verdict: Verdict;
  request: ClearanceRequest;
  signals: Signal[];
  simulation?: SimulationResult;
  summary: string;
  checkedAt: string;
}

/** Local memory Clearance keeps between runs. */
export interface Store {
  knownReceivers(vaultId: string): Promise<Set<string>>;
  rememberReceiver(vaultId: string, receiverId: string): Promise<void>;
  lastCodeHash(accountId: string): Promise<{ hash: string; seenAt: string } | undefined>;
  saveCodeHash(accountId: string, hash: string): Promise<void>;
}

export interface ClearanceConfig {
  network?: Network;
  rpcUrl?: string;
  /** code_hash values of audited vault builds; anything else is blocked. */
  expectedVaultCodeHashes?: string[];
  registryId?: string;
  /** Well-known accounts used for look-alike detection (in addition to history and allowlist). */
  knownAccounts?: string[];
  /** `null` disables the indexer check (e.g. local sandbox, which NearBlocks does not index). */
  nearblocksUrl?: string | null;
  /** Accounts younger than this are flagged. Default 7. */
  newAccountDays?: number;
  /** Accounts with fewer transactions are flagged. Default 5. */
  minTxCount?: number;
  store?: Store;
  simulate?: (req: ClearanceRequest) => Promise<SimulationResult>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}
