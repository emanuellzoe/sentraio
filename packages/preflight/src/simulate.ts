// Sandbox simulation of an agent action against the *real* token code, with the
// vault's and receiver's real balances mirrored in. Big contracts refuse remote
// view_state, so balances are rebuilt: learn the storage layout locally with a probe
// account, then write the real value read through view methods.
import { analyzeTx, RPC_URLS, viewFunction } from '@sentineli/core';
import type { Network, RawTx } from '@sentineli/core';
import type { PreflightRequest, Signal, SimulationResult } from './types.ts';

type NW = typeof import('near-workspaces');
type Worker = Awaited<ReturnType<NW['Worker']['init']>>;
type NearAccount = Worker['rootAccount'];

const SANDBOX_VERSION = '2.14.0';
const MARKER = 123_456_789_123n;
const u128le = (n: bigint) => {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(n & 0xffff_ffff_ffff_ffffn);
  b.writeBigUInt64LE(n >> 64n, 8);
  return b;
};
const sig = (id: string, level: Signal['level'], title: string, detail: string): Signal => ({ id, level, title, detail, source: 'sandbox' });

interface Layout {
  balancePrefix: Buffer;
  supplyOffset?: number;
}

export interface SimulatorOptions {
  network?: Network;
}

export class Simulator {
  private nw?: NW;
  private worker?: Worker;
  private readonly network: Network;
  /** accountId -> code_hash currently loaded in the sandbox */
  private readonly loaded = new Map<string, string>();
  /** token code_hash -> learned storage layout (undefined = could not learn) */
  private readonly layouts = new Map<string, Layout | undefined>();
  private readonly fullState = new Set<string>();

  constructor(opts: SimulatorOptions = {}) {
    this.network = opts.network ?? 'testnet';
  }

  async start(): Promise<void> {
    if (this.worker) return;
    // near-workspaces ships an old neard that cannot load current wasm; fetch a current one on first install
    if (!process.env.SANDBOX_ARTIFACT_URL && process.platform === 'darwin' && process.arch === 'arm64') {
      process.env.SANDBOX_ARTIFACT_URL = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/${SANDBOX_VERSION}/near-sandbox.tar.gz`;
    }
    this.nw = ((await import('near-workspaces')) as unknown as { default: NW }).default;
    this.worker = await this.nw.Worker.init();
  }

  async stop(): Promise<void> {
    await this.worker?.tearDown();
    this.worker = undefined;
    this.loaded.clear();
    this.layouts.clear();
    this.fullState.clear();
  }

  /** Bound function for `PreflightConfig.simulate`. */
  get simulate() {
    return (req: PreflightRequest) => this.run(req);
  }

  async run(req: PreflightRequest): Promise<SimulationResult> {
    const t0 = Date.now();
    const { action } = req;
    if (action.type === 'near_transfer') {
      return { coverage: 'skipped', signals: [sig('simulation', 'ok', 'Native transfer needs no simulation', 'Receiver existence is checked separately.')], durationMs: 0 };
    }
    await this.start();
    const signals: Signal[] = [];

    const [token, vault] = await Promise.all([
      this.load(action.token, true),
      this.load(req.vaultId, false),
      this.load(action.receiver_id, action.type === 'ft_transfer_call'),
    ]);
    const layout = await this.tokenLayout(token);

    let coverage: SimulationResult['coverage'] = 'full';
    if (!this.fullState.has(action.token)) {
      if (!layout) {
        signals.push(sig('simulation_state', 'warn', 'Token state could not be reproduced', `${action.token} uses a non-standard storage layout; balances in the sandbox are not real.`));
        coverage = 'partial';
      } else {
        await this.mirrorToken(action.token, layout, [req.vaultId, action.receiver_id]);
      }
    }

    const method = action.type === 'ft_transfer_call' ? 'ft_transfer_call' : 'ft_transfer';
    const args = action.type === 'ft_transfer_call'
      ? { receiver_id: action.receiver_id, amount: action.amount, msg: action.msg }
      : { receiver_id: action.receiver_id, amount: action.amount, memo: action.memo ?? null };
    const result = await vault.callRaw(token, method, args, { attachedDeposit: 1n, gas: method === 'ft_transfer_call' ? 300_000_000_000_000n : 30_000_000_000_000n });
    const report = analyzeTx(result.result as unknown as RawTx);

    const notReproduced = report.failures.find((f) => ['CONTRACT_NOT_INITIALIZED', 'NO_CONTRACT'].includes(f.error.code) && f.executor !== action.token);
    if (notReproduced) {
      coverage = 'partial';
      signals.push(sig('simulation_partial', 'warn', 'Receiver contract could not be fully simulated',
        `${notReproduced.executor} has too much state to copy, so its ft_on_transfer ran uninitialized; the sandbox shows a refund that may not happen for real.`));
    } else if (report.failures.length > 0) {
      const f = report.failures[0];
      signals.push(sig('simulation_failed', 'warn', 'Action fails in simulation', `${f.executor}: ${f.error.title}. ${f.error.hint ?? f.error.detail}`));
    }

    // value checks: the vault may lose at most `amount` of the token, and a plain transfer may only pay the receiver
    const amount = BigInt(action.amount);
    const vaultDelta = BigInt(report.net[req.vaultId]?.[action.token] ?? '0');
    if (-vaultDelta > amount) {
      signals.push(sig('simulation_overspend', 'block', 'Vault loses more than the stated amount', `Simulated loss ${-vaultDelta}, stated ${amount}.`));
    }
    if (action.type === 'ft_transfer') {
      const strangers = Object.entries(report.net).filter(([acc, d]) => acc !== action.receiver_id && acc !== req.vaultId && BigInt(d[action.token] ?? '0') > 0n);
      for (const [acc] of strangers) {
        signals.push(sig('simulation_third_party', 'block', 'Tokens flow to a third party', `${acc} receives ${action.token} although the receiver is ${action.receiver_id} (fee-on-transfer or drainer token?).`));
      }
    }
    if (!signals.some((s) => s.level !== 'ok')) {
      signals.push(sig('simulation', 'ok', 'Simulation matches the stated action', report.headline));
    }
    return { coverage, report, signals, durationMs: Date.now() - t0 };
  }

  /** Imports an account (and its code) from the real network; small contracts come with their full state. */
  private async load(accountId: string, wantState: boolean): Promise<NearAccount> {
    const nw = this.nw!;
    const root = this.worker!.rootAccount;
    // the near.org default RPC is slow/unreliable; use the same endpoint as the rest of Sentineli
    const rpc = nw.JsonRpcProvider.from(RPC_URLS[this.network].regular);
    const view = await rpc.viewAccount(accountId);
    if (this.loaded.get(accountId) === view.code_hash) return root.getAccount(accountId);

    const account = root.getAccount(accountId);
    const pubKey = await account.setKey();
    const hasCode = view.code_hash !== nw.EMPTY_CONTRACT_HASH;
    const code = hasCode ? await rpc.viewCodeRaw(accountId) : undefined;
    const codeSize = code ? Buffer.from(code, 'base64').length : 0;
    // storage_usage reflects the remote state; keep it small or the local node refuses view_state too
    // recordBuilder exists on the sandbox Account class but not on the NearAccount interface
    const records = (account as unknown as { recordBuilder(): any }).recordBuilder()
      .account({ ...view, amount: (BigInt(view.amount) + 10n ** 26n).toString(), storage_usage: codeSize + 1000 })
      .accessKey(pubKey);
    if (code) records.contract(code);
    await account.patchStateRecords(records);

    if (hasCode && wantState) {
      try {
        const data = await rpc.viewStateRaw(accountId, '');
        await account.patchStateRecords({ records: data.map(({ key, value }) => ({ Data: { account_id: accountId, data_key: key, value } })) });
        this.fullState.add(accountId);
      } catch {
        // TOO_LARGE_CONTRACT_STATE: handled by layout learning / partial coverage
      }
    }
    this.loaded.set(accountId, view.code_hash);
    return account;
  }

  /** Initialize a code-only token with a probe owner and find where balances and total supply live. */
  private async tokenLayout(token: NearAccount): Promise<Layout | undefined> {
    if (this.fullState.has(token.accountId)) return undefined;
    const codeHash = this.loaded.get(token.accountId)!;
    if (this.layouts.has(codeHash)) return this.layouts.get(codeHash);

    const root = this.worker!.rootAccount;
    const probe = await root.createSubAccount(`probe${Date.now() % 1e9}`, { initialBalance: 10n ** 25n });
    const marker = MARKER.toString();
    // Common NEP-141 initializers mint total_supply to owner_id. Unknown JSON fields are
    // ignored by near-sdk, so `new(...)` can also "succeed" on a no-arg init like wrap's.
    const inits: (() => Promise<unknown>)[] = [
      () => token.call(token, 'new_default_meta', { owner_id: probe.accountId, total_supply: marker }),
      () => token.call(token, 'new', { owner_id: probe.accountId, total_supply: marker, metadata: { spec: 'ft-1.0.0', name: 'sim', symbol: 'SIM', decimals: 18 } }),
      () => token.call(token, 'new', {}),
    ];
    for (const init of inits) {
      try {
        await init();
        break;
      } catch {
        /* try the next initializer */
      }
    }
    const probeBalance = await token.view('ft_balance_of', { account_id: probe.accountId }).catch(() => '0');
    if (String(probeBalance) !== marker) {
      // wrapped-NEAR style tokens mint on deposit instead
      try {
        await probe.call(token, 'storage_deposit', {}, { attachedDeposit: 125n * 10n ** 19n });
        await probe.call(token, 'near_deposit', {}, { attachedDeposit: MARKER });
      } catch {
        /* layout stays unknown -> partial coverage */
      }
    }

    const state = await this.worker!.provider.viewStateRaw(token.accountId, '');
    const id = Buffer.from(probe.accountId);
    const hit = state.find((kv) => Buffer.from(kv.key, 'base64').includes(id) && Buffer.from(kv.value, 'base64').equals(u128le(MARKER)));
    let layout: Layout | undefined;
    if (hit) {
      const key = Buffer.from(hit.key, 'base64');
      layout = { balancePrefix: key.subarray(0, key.indexOf(id) - 4) };
      const stateVal = state.find((kv) => Buffer.from(kv.key, 'base64').toString() === 'STATE');
      const at = stateVal ? Buffer.from(stateVal.value, 'base64').indexOf(u128le(MARKER)) : -1;
      if (at >= 0) layout.supplyOffset = at;
    }
    this.layouts.set(codeHash, layout);
    return layout;
  }

  /** Write real balances (and real total supply) into the sandbox copy of the token. */
  private async mirrorToken(tokenId: string, layout: Layout, accounts: string[]): Promise<void> {
    const opts = { network: this.network };
    const token = this.worker!.rootAccount.getAccount(tokenId);
    const records: { Data: { account_id: string; data_key: string; value: string } }[] = [];
    const keyFor = (id: string) => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(Buffer.byteLength(id));
      return Buffer.concat([layout.balancePrefix, len, Buffer.from(id)]).toString('base64');
    };
    const balances = await Promise.all(accounts.map(async (id) => {
      // an unregistered account must stay unregistered, or the sandbox hides "not registered" failures
      const [registered, balance] = await Promise.all([
        viewFunction<unknown>(tokenId, 'storage_balance_of', { account_id: id }, opts).catch(() => null),
        viewFunction<string>(tokenId, 'ft_balance_of', { account_id: id }, opts),
      ]);
      return registered === null ? undefined : { id, balance: BigInt(balance) };
    }));
    for (const b of balances) {
      if (b) records.push({ Data: { account_id: tokenId, data_key: keyFor(b.id), value: u128le(b.balance).toString('base64') } });
    }
    if (layout.supplyOffset !== undefined) {
      const [state, supply] = await Promise.all([
        this.worker!.provider.viewStateRaw(tokenId, ''),
        viewFunction<string>(tokenId, 'ft_total_supply', {}, opts),
      ]);
      const kv = state.find((s) => Buffer.from(s.key, 'base64').toString() === 'STATE');
      if (kv) {
        const value = Buffer.from(kv.value, 'base64');
        u128le(BigInt(supply)).copy(value, layout.supplyOffset);
        records.push({ Data: { account_id: tokenId, data_key: kv.key, value: value.toString('base64') } });
      }
    }
    if (records.length) await token.patchStateRecords({ records });
  }
}
