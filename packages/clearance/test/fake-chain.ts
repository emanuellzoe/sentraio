// Minimal stand-in for a NEAR RPC node + NearBlocks, so every Clearance branch can be driven.
export const EMPTY = '11111111111111111111111111111111';
const DAY_NS = 86_400n * 1_000_000_000n;

export interface FakeAccount {
  code_hash?: string;
  /** days since creation as NearBlocks reports it; undefined = indexer has no record */
  ageDays?: number;
  txCount?: number;
}

export class FakeChain {
  accounts = new Map<string, FakeAccount>();
  views = new Map<string, (args: any) => unknown>();
  nearblocksDown = false;
  calls: string[] = [];
  readonly now = new Date('2026-11-02T00:00:00Z');

  account(id: string, a: FakeAccount = {}) {
    this.accounts.set(id, { code_hash: EMPTY, ageDays: 400, txCount: 1000, ...a });
    return this;
  }
  view(contract: string, method: string, fn: (args: any) => unknown) {
    this.views.set(`${contract}.${method}`, fn);
    return this;
  }

  fetch: typeof fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('nearblocks')) return this.nearblocks(url);
    const { params } = JSON.parse(String(init?.body));
    if (params.request_type === 'view_account') {
      const a = this.accounts.get(params.account_id);
      return a
        ? json({ result: { amount: '1', locked: '0', code_hash: a.code_hash, storage_usage: 100, block_height: 1 } })
        : json({ error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'unknown' } });
    }
    if (params.request_type === 'call_function') {
      const key = `${params.account_id}.${params.method_name}`;
      this.calls.push(key);
      const fn = this.views.get(key);
      if (!fn) return json({ error: { name: 'HANDLER_ERROR', cause: { name: 'METHOD_NOT_FOUND' }, message: key } });
      const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString() || '{}');
      return json({ result: { result: [...Buffer.from(JSON.stringify(fn(args)))] } });
    }
    throw new Error(`unexpected rpc ${JSON.stringify(params)}`);
  }) as typeof fetch;

  private nearblocks(url: string) {
    if (this.nearblocksDown) return new Response('busy', { status: 503 });
    const m = url.match(/\/v1\/account\/([^/]+)(\/txns-only\/count)?$/)!;
    const a = this.accounts.get(m[1]);
    if (m[2]) return json({ txns: [{ count: String(a?.txCount ?? 0) }] });
    if (!a || a.ageDays === undefined) return json({ account: [{ block_height: '1' }] });
    const created = BigInt(this.now.getTime()) * 1_000_000n - BigInt(Math.round(a.ageDays * 1000)) * DAY_NS / 1000n;
    return json({ account: [{ account_id: m[1], created: { block_timestamp: Number(created) } }] });
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
