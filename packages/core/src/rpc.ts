import type { RawTx } from './types.ts';

export type Network = 'testnet' | 'mainnet';

/** Regular nodes keep ~2-3 days of history; older transactions only exist on archival nodes. */
export const RPC_URLS: Record<Network, { regular: string; archival: string }> = {
  testnet: { regular: 'https://test.rpc.fastnear.com', archival: 'https://archival-rpc.testnet.fastnear.com' },
  mainnet: { regular: 'https://free.rpc.fastnear.com', archival: 'https://archival-rpc.mainnet.fastnear.com' },
};

export interface FetchTxParams {
  hash: string;
  /** Signer of the transaction; RPC uses it to find the right shard. */
  sender: string;
  network?: Network;
  /** Use exactly this endpoint (no archival fallback). */
  rpcUrl?: string;
  /** Per-request timeout. The regular node gets a short one: for a transaction it no longer
   *  has, it waits for "FINAL" until its own timeout instead of answering "unknown". */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

// A regular node answers these for transactions it never saw or already garbage-collected.
const RETRY_ON_ARCHIVAL = new Set(['UNKNOWN_TRANSACTION', 'TIMEOUT_ERROR', 'GARBAGE_COLLECTED_BLOCK', 'HTTP_TIMEOUT']);

/** Full transaction with receipts (actions, predecessors) via EXPERIMENTAL_tx_status. */
export async function fetchTx({ hash, sender, network = 'testnet', rpcUrl, timeoutMs = 15_000, fetchImpl = fetch }: FetchTxParams): Promise<RawTx> {
  const call = (url: string, ms: number) => rpc<RawTx>(url, 'EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' }, ms, fetchImpl);
  if (rpcUrl) return call(rpcUrl, timeoutMs);
  try {
    return await call(RPC_URLS[network].regular, Math.min(timeoutMs, 4_000));
  } catch (e) {
    if (e instanceof RpcError && RETRY_ON_ARCHIVAL.has(e.code)) return call(RPC_URLS[network].archival, timeoutMs);
    throw e;
  }
}

/** Reads `decimals` from each token's ft_metadata (NEP-148); tokens that fail are skipped. */
export async function fetchFtDecimals(tokens: string[], { network = 'testnet', fetchImpl = fetch }: { network?: Network; fetchImpl?: typeof fetch } = {}): Promise<Record<string, number>> {
  const entries = await Promise.all(
    [...new Set(tokens)].map(async (token) => {
      try {
        const r = await rpc<{ result: number[] }>(RPC_URLS[network].regular, 'query', {
          request_type: 'call_function', finality: 'final', account_id: token, method_name: 'ft_metadata', args_base64: '',
        }, 5_000, fetchImpl);
        const meta = JSON.parse(Buffer.from(r.result).toString('utf8')) as { decimals?: number };
        return typeof meta.decimals === 'number' ? ([token, meta.decimals] as const) : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e) => e !== undefined));
}

async function rpc<T>(url: string, method: string, params: unknown, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'sentineli', method, params }),
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new RpcError('HTTP_TIMEOUT', `${url} did not answer in ${timeoutMs} ms`);
    throw e;
  }
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { name?: string; cause?: { name?: string }; message?: string } };
  if (body.error) throw new RpcError(body.error.cause?.name ?? body.error.name ?? 'RPC_ERROR', body.error.message ?? 'request failed');
  if (!res.ok) throw new RpcError(res.status === 408 ? 'HTTP_TIMEOUT' : `HTTP_${res.status}`, url);
  if (!body.result) throw new RpcError('EMPTY_RESULT', 'RPC returned no result');
  return body.result;
}
