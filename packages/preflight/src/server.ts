// Preflight as a separate service: it holds the guardian key, the agent never does.
//   POST /check                {vaultId, agentId, action}  (agent token)
//   GET  /pending/:id                                       (agent token: poll)
//   GET  /pending                                           (operator token)
//   GET  /checks                                            (operator token: decision log, newest first)
//   POST /pending/:id/confirm  {by}                         (operator token)
//   POST /pending/:id/reject   {by, reason?}                (operator token)
// The agent token can only ask; confirming a warn needs the operator token, so a
// compromised agent cannot approve its own flagged payment.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { approve } from './approval.ts';
import type { Approval } from './approval.ts';
import { runPreflight } from './decide.ts';
import { MemoryStore } from './store.ts';
import type { Decision, PreflightConfig, PreflightRequest } from './types.ts';

export type CheckStatus = 'approved' | 'refused' | 'needs_human' | 'rejected' | 'expired';

export interface CheckResponse {
  status: CheckStatus;
  id: string;
  decision: Decision;
  approval?: Approval;
  by?: string;
  reason?: string;
}

export interface ServerOptions extends PreflightConfig {
  guardianSecretKey: string;
  agentToken: string;
  operatorToken: string;
  port?: number;
  host?: string;
  /** Unanswered warns expire after this. Default 5 minutes. */
  humanTimeoutMs?: number;
  onEvent?: (e: CheckResponse) => void;
}

export interface PreflightServer {
  url: string;
  close(): Promise<void>;
}

export async function startPreflightServer(opts: ServerOptions): Promise<PreflightServer> {
  const store = opts.store ?? new MemoryStore();
  const cfg: PreflightConfig = { ...opts, store };
  const view = { network: opts.network, rpcUrl: opts.rpcUrl, fetchImpl: opts.fetchImpl };
  const checks = new Map<string, CheckResponse & { createdAt: number }>();

  const sign = async (decision: Decision, humanConfirmedBy?: string) => {
    const approval = await approve(decision, { ...view, guardianSecretKey: opts.guardianSecretKey, humanConfirmedBy });
    await store.rememberReceiver(decision.request.vaultId, decision.request.action.receiver_id);
    return approval;
  };
  const publish = (c: CheckResponse & { createdAt: number }) => {
    checks.set(c.id, c);
    opts.onEvent?.(c);
    return c;
  };

  const expireStale = () => {
    for (const c of checks.values()) {
      if (c.status === 'needs_human' && Date.now() - c.createdAt > (opts.humanTimeoutMs ?? 300_000)) publish({ ...c, status: 'expired' });
    }
  };

  const routes = async (req: IncomingMessage, path: string[], body: any): Promise<[number, unknown]> => {
    const role = tokenRole(req, opts);
    expireStale();
    if (req.method === 'POST' && path[0] === 'check' && path.length === 1) {
      if (role !== 'agent') return [401, { error: 'agent token required' }];
      const request = body as PreflightRequest;
      if (!request?.vaultId || !request?.agentId || !request?.action) return [400, { error: 'vaultId, agentId, action required' }];
      const decision = await runPreflight(request, cfg);
      const base = { id: randomUUID(), decision, createdAt: Date.now() };
      if (decision.verdict === 'block') return [200, strip(publish({ ...base, status: 'refused' }))];
      if (decision.verdict === 'warn') return [200, strip(publish({ ...base, status: 'needs_human' }))];
      return [200, strip(publish({ ...base, status: 'approved', approval: await sign(decision) }))];
    }

    if (req.method === 'GET' && path[0] === 'checks' && path.length === 1) {
      if (role !== 'operator') return [401, { error: 'operator token required' }];
      return [200, [...checks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map((c) => ({ ...strip(c), at: new Date(c.createdAt).toISOString() }))];
    }
    if (path[0] !== 'pending') return [404, { error: 'not found' }];
    if (req.method === 'GET' && path.length === 1) {
      if (role !== 'operator') return [401, { error: 'operator token required' }];
      return [200, [...checks.values()].filter((c) => c.status === 'needs_human').map(strip)];
    }
    const cur = checks.get(path[1] ?? '');
    if (!cur) return [404, { error: 'unknown check' }];

    if (req.method === 'GET' && path.length === 2) {
      if (!role) return [401, { error: 'token required' }];
      return [200, strip(cur)];
    }
    if (req.method === 'POST' && (path[2] === 'confirm' || path[2] === 'reject')) {
      if (role !== 'operator') return [403, { error: 'only the operator can answer a warn' }];
      if (cur.status !== 'needs_human') return [409, { error: `check is ${cur.status}` }];
      const by = String(body?.by ?? '').trim();
      if (!by) return [400, { error: '"by" (who decided) is required' }];
      if (path[2] === 'reject') return [200, strip(publish({ ...cur, status: 'rejected', by, reason: body?.reason }))];
      // re-run the checks: state may have changed while the human was deciding
      const fresh = await runPreflight(cur.decision.request, cfg);
      if (fresh.verdict === 'block') return [200, strip(publish({ ...cur, decision: fresh, status: 'refused', by }))];
      return [200, strip(publish({ ...cur, decision: fresh, status: 'approved', by, approval: await sign(fresh, by) }))];
    }
    return [404, { error: 'not found' }];
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      const [code, payload] = await routes(req, url.pathname.split('/').filter(Boolean), body);
      send(res, code, payload);
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${opts.host ?? '127.0.0.1'}:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const strip = ({ createdAt: _c, ...rest }: CheckResponse & { createdAt?: number }): CheckResponse => rest;

function tokenRole(req: IncomingMessage, opts: ServerOptions): 'agent' | 'operator' | undefined {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (token && eq(token, opts.operatorToken)) return 'operator';
  if (token && eq(token, opts.agentToken)) return 'agent';
  return undefined;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res: ServerResponse, code: number, payload: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}
