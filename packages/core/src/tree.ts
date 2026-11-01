import { explainError } from './errors.ts';
import type { ActionSummary, NearEvent, RawAction, RawOutcome, RawReceipt, RawTx, ReceiptNode } from './types.ts';

const TGAS = 1e12;

export function decodeBase64Json(b64: string): unknown {
  const text = Buffer.from(b64, 'base64').toString('utf8');
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseEvents(logs: string[]): NearEvent[] {
  return logs.flatMap((log) => {
    if (!log.startsWith('EVENT_JSON:')) return [];
    try {
      const e = JSON.parse(log.slice('EVENT_JSON:'.length));
      return typeof e?.standard === 'string' && typeof e?.event === 'string' ? [e as NearEvent] : [];
    } catch {
      return [];
    }
  });
}

function summarizeAction(a: RawAction): ActionSummary {
  if (typeof a === 'string') return { kind: 'other', type: a };
  if ('FunctionCall' in a) {
    const fc = (a as Extract<RawAction, { FunctionCall: unknown }>).FunctionCall;
    return { kind: 'function_call', method: fc.method_name, args: decodeBase64Json(fc.args), deposit: fc.deposit, gasTgas: Number(fc.gas) / TGAS };
  }
  if ('Transfer' in a) return { kind: 'transfer', deposit: (a as { Transfer: { deposit: string } }).Transfer.deposit };
  return { kind: 'other', type: Object.keys(a)[0] ?? 'unknown' };
}

export const totalDeposit = (actions: ActionSummary[]) =>
  actions.reduce((sum, a) => sum + (a.kind === 'other' ? 0n : BigInt(a.deposit)), 0n);

/** Builds the receipt tree rooted at the transaction's first receipt. */
export function buildTree(tx: RawTx): ReceiptNode {
  const outcomes = new Map<string, RawOutcome>(tx.receipts_outcome.map((o) => [o.id, o]));
  const receipts = new Map<string, RawReceipt>((tx.receipts ?? []).map((r) => [r.receipt_id, r]));

  const build = (id: string, parent?: ReceiptNode): ReceiptNode => {
    const o = outcomes.get(id);
    const r = receipts.get(id);
    const actions = (r?.receipt.Action?.actions ?? []).map(summarizeAction);
    const status = o?.outcome.status ?? { Unknown: null };
    const ok = 'SuccessValue' in status || 'SuccessReceiptId' in status;
    const fromSystem = r?.predecessor_id === 'system';
    const node: ReceiptNode = {
      id,
      predecessor: r?.predecessor_id,
      receiver: r?.receiver_id ?? o?.outcome.executor_id ?? '?',
      role: fromSystem ? (isDepositRefund(actions, parent) ? 'deposit_refund' : 'gas_refund') : 'call',
      actions,
      ok,
      gasTgas: (o?.outcome.gas_burnt ?? 0) / TGAS,
      logs: o?.outcome.logs ?? [],
      events: parseEvents(o?.outcome.logs ?? []),
      children: [],
    };
    if ('SuccessValue' in status) node.returnValue = decodeBase64Json(status.SuccessValue);
    if ('Failure' in status) {
      const method = actions.find((a) => a.kind === 'function_call')?.method;
      node.error = explainError(status.Failure, { executor: node.receiver, method });
    }
    node.children = (o?.outcome.receipt_ids ?? []).filter((c) => outcomes.has(c)).map((c) => build(c, node));
    return node;
  };

  const rootId = tx.transaction_outcome.outcome.receipt_ids[0];
  const root = build(rootId);
  // the transaction itself carries the signer's actions when `receipts` is absent
  root.predecessor ??= tx.transaction.signer_id;
  return root;
}

/** The runtime returns a failed receipt's attached deposit to its predecessor via `system`. */
function isDepositRefund(actions: ActionSummary[], parent?: ReceiptNode): boolean {
  if (!parent || parent.ok) return false;
  const back = totalDeposit(actions);
  return back > 0n && back === totalDeposit(parent.actions);
}

export function walk(node: ReceiptNode, visit: (n: ReceiptNode, depth: number) => void, depth = 0): void {
  visit(node, depth);
  for (const c of node.children) walk(c, visit, depth + 1);
}
