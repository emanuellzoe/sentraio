// --- Raw RPC shapes (only the fields we read) -------------------------------

export type ExecutionStatus =
  | { SuccessValue: string }
  | { SuccessReceiptId: string }
  | { Failure: unknown }
  | { Unknown: null };

export interface RawOutcome {
  id: string;
  outcome: {
    executor_id: string;
    gas_burnt: number;
    logs: string[];
    receipt_ids: string[];
    status: ExecutionStatus;
  };
}

export type RawAction =
  | { FunctionCall: { method_name: string; args: string; deposit: string; gas: number | string } }
  | { Transfer: { deposit: string } }
  | Record<string, unknown>
  | string;

export interface RawReceipt {
  receipt_id: string;
  predecessor_id: string;
  receiver_id: string;
  receipt: { Action?: { actions: RawAction[]; signer_id: string } } & Record<string, unknown>;
}

/** `EXPERIMENTAL_tx_status` response. `receipts` is missing in plain `tx` results
 *  (e.g. near-workspaces), so everything that depends on it is optional. */
export interface RawTx {
  status: ExecutionStatus;
  transaction: { hash: string; signer_id: string; receiver_id: string };
  transaction_outcome: RawOutcome;
  receipts_outcome: RawOutcome[];
  receipts?: RawReceipt[];
}

// --- Report ----------------------------------------------------------------

export type ActionSummary =
  | { kind: 'function_call'; method: string; args: unknown; deposit: string; gasTgas: number }
  | { kind: 'transfer'; deposit: string }
  | { kind: 'other'; type: string };

export interface ExplainedError {
  code: string;
  title: string;
  detail: string;
  hint?: string;
  raw: unknown;
}

export interface NearEvent {
  standard: string;
  version: string;
  event: string;
  data: unknown;
}

export type ReceiptRole = 'call' | 'gas_refund' | 'deposit_refund';

export interface ReceiptNode {
  id: string;
  predecessor?: string;
  receiver: string;
  role: ReceiptRole;
  actions: ActionSummary[];
  ok: boolean;
  returnValue?: unknown;
  error?: ExplainedError;
  gasTgas: number;
  logs: string[];
  events: NearEvent[];
  children: ReceiptNode[];
}

export type MovementKind = 'transfer' | 'refund' | 'mint' | 'burn';

/** A value move that really happened (taken from successful receipts only). */
export interface Movement {
  /** "NEAR" or the token contract account id. */
  asset: string;
  kind: MovementKind;
  from?: string;
  to?: string;
  amount: string;
  receiptId: string;
}

export type Verdict = 'success' | 'partial' | 'failed' | 'rejected';

export interface TxReport {
  hash: string;
  signer: string;
  receiver: string;
  verdict: Verdict;
  headline: string;
  returnValue?: unknown;
  root: ReceiptNode;
  failures: { receiptId: string; executor: string; error: ExplainedError }[];
  movements: Movement[];
  /** account -> asset -> signed net change (yocto / token base units, decimal string). */
  net: Record<string, Record<string, string>>;
  events: NearEvent[];
  gasTgas: number;
}
