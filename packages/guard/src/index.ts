// Agent-side wrapper. The agent holds only a function-call key scoped to the vault's
// `execute`; every payment is first sent to the Clearance service:
//   refused     -> never signed
//   needs_human -> wait for the operator (the agent cannot answer its own warn)
//   approved    -> execute(action, approval) on the vault, then explain the outcome
import { analyzeTx, fetchTx } from '@sentraio/core';
import type { Network, TxReport } from '@sentraio/core';
import type { AgentAction, CheckResponse } from '@sentraio/clearance';
import { Account, actions, JsonRpcProvider } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';

export type GuardStatus = 'executed' | 'failed' | 'refused' | 'rejected_by_human' | 'expired' | 'vault_rejected';

export interface GuardResult {
  status: GuardStatus;
  /** One line a human (or the LLM) can read. */
  message: string;
  check: CheckResponse;
  report?: TxReport;
  txHash?: string;
}

export interface GuardOptions {
  vaultId: string;
  agentId: string;
  /** Function-call access key of the agent account, limited to `vaultId` / `execute`. */
  agentKey: KeyPairString;
  clearanceUrl: string;
  agentToken: string;
  network?: Network;
  rpcUrl: string;
  pollMs?: number;
  onEvent?: (e: { stage: 'checking' | 'waiting_for_human' | 'executing' | 'done'; detail: string }) => void;
}

export class Guard {
  private readonly opts: GuardOptions;
  private readonly account: Account;

  constructor(opts: GuardOptions) {
    this.opts = opts;
    this.account = new Account(opts.agentId, new JsonRpcProvider({ url: opts.rpcUrl }), opts.agentKey);
  }

  async pay(action: AgentAction): Promise<GuardResult> {
    const emit = this.opts.onEvent ?? (() => {});
    emit({ stage: 'checking', detail: `${action.type} ${action.amount} -> ${action.receiver_id}` });
    let check = await this.post('/check', { vaultId: this.opts.vaultId, agentId: this.opts.agentId, action });

    if (check.status === 'needs_human') {
      emit({ stage: 'waiting_for_human', detail: check.decision.summary });
      check = await this.waitForHuman(check.id);
    }
    if (check.status !== 'approved' || !check.approval) {
      const status: GuardStatus = check.status === 'rejected' ? 'rejected_by_human' : check.status === 'expired' ? 'expired' : 'refused';
      const message = status === 'rejected_by_human'
        ? `A human rejected this payment${check.reason ? `: ${check.reason}` : ''}.`
        : status === 'expired' ? 'Nobody confirmed the warning in time; payment not sent.' : `Refused by Clearance. ${check.decision.summary}`;
      emit({ stage: 'done', detail: message });
      return { status, message, check };
    }

    emit({ stage: 'executing', detail: `approved${check.by ? ` by ${check.by}` : ''}` });
    const sent = await this.account.signAndSendTransaction({
      receiverId: this.opts.vaultId,
      actions: [actions.functionCall('execute', { action, approval: check.approval }, 150_000_000_000_000n, 0n)],
      waitUntil: 'FINAL',
      throwOnFailure: false,
    });
    const txHash = (sent as unknown as { transaction: { hash: string } }).transaction.hash;
    // let the operator's decision log link straight to the transaction
    await this.post(`/checks/${check.id}/executed`, { txHash }).catch(() => {});
    const report = analyzeTx(await fetchTx({ hash: txHash, sender: this.opts.agentId, rpcUrl: this.opts.rpcUrl }));
    const status: GuardStatus = report.verdict === 'success' ? 'executed' : report.verdict === 'rejected' ? 'vault_rejected' : 'failed';
    emit({ stage: 'done', detail: report.headline });
    return { status, message: report.headline, check, report, txHash };
  }

  private async waitForHuman(id: string): Promise<CheckResponse> {
    for (;;) {
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 1_000));
      const c = await this.get(`/pending/${id}`);
      if (c.status !== 'needs_human') return c;
    }
  }

  private async post(path: string, body: unknown): Promise<CheckResponse> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async get(path: string): Promise<CheckResponse> {
    return this.request(path, { method: 'GET' });
  }

  private async request(path: string, init: RequestInit): Promise<CheckResponse> {
    const res = await fetch(`${this.opts.clearanceUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.agentToken}` },
    });
    const body = (await res.json()) as CheckResponse & { error?: string };
    if (!res.ok) throw new Error(`clearance ${res.status}: ${body.error ?? 'request failed'}`);
    return body;
  }
}

/** OpenAI-style tool definition so an LLM agent can only pay through the guard. */
export const payTool = {
  type: 'function',
  function: {
    name: 'pay',
    description: 'Pay an invoice from the agent vault. Every payment is checked by Sentraio Clearance; blocked payments are refused.',
    parameters: {
      type: 'object',
      properties: {
        receiver_id: { type: 'string', description: 'NEAR account to pay' },
        amount_near: { type: 'string', description: 'Amount in NEAR, e.g. "2.5"' },
        reason: { type: 'string', description: 'Why this payment is due' },
      },
      required: ['receiver_id', 'amount_near', 'reason'],
    },
  },
} as const;
